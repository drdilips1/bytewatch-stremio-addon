package app.inkwell.books;

import android.util.Base64;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Sends one file as an e-mail attachment through a mail server (SMTP) — Gmail by default
 * (smtp.gmail.com, SSL, a Google "app password"), or your own: any host and port, encrypted from
 * the start (SSL, usually 465), upgraded with STARTTLS (usually 587), or plain. Used by Send to
 * Kindle, so books go straight to a Kindle's @kindle.com address without an e-mail app.
 * Nothing is stored here. (The class keeps its old name.)
 */
final class GmailSender {
    private GmailSender() {}

    /** Most servers take 25 MB per message; the attachment grows by a third when encoded. */
    static final long MAX_BYTES = 18L * 1024 * 1024;

    /** Gmail, as before. */
    static void send(String from, String password, List<String> to, String subject, File file, String fileName, String mime) throws Exception {
        send("smtp.gmail.com", 465, "ssl", from, from, password, to, subject, file, fileName, mime);
    }

    static String server = "Gmail";

    static void send(String host, int port, String security, String user, String from, String password, List<String> to, String subject, File file, String fileName, String mime) throws Exception {
        server = "smtp.gmail.com".equals(host) ? "Gmail" : host;
        if (file.length() > MAX_BYTES) throw new Exception("the book is " + (file.length() / (1024 * 1024)) + " MB — mail servers send up to about 18 MB");
        java.net.Socket s = "ssl".equals(security) ? SSLSocketFactory.getDefault().createSocket(host, port) : new java.net.Socket(host, port);
        s.setSoTimeout(60_000);
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII));
            OutputStream out = s.getOutputStream();
            expect(in, 220);
            cmd(out, in, "EHLO audiohub", 250);
            if ("starttls".equals(security)) {
                // Upgrade the plain connection to an encrypted one, then introduce ourselves again.
                cmd(out, in, "STARTTLS", 220);
                SSLSocket tls = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(s, host, port, true);
                tls.setSoTimeout(60_000);
                tls.startHandshake();
                s = tls;
                in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII));
                out = s.getOutputStream();
                cmd(out, in, "EHLO audiohub", 250);
            }
            cmd(out, in, "AUTH LOGIN", 334);
            cmd(out, in, b64(user.isEmpty() ? from : user), 334);
            int auth = cmd(out, in, b64("Gmail".equals(server) ? password.replace(" ", "") : password), -1);
            if (auth != 235) throw new Exception(server + " didn't accept the password for " + (user.isEmpty() ? from : user) + " (check it in Settings → Send to Kindle)");
            cmd(out, in, "MAIL FROM:<" + from + ">", 250);
            for (String t : to) cmd(out, in, "RCPT TO:<" + t + ">", 250);
            cmd(out, in, "DATA", 354);

            String boundary = "ah-" + UUID.randomUUID();
            StringBuilder head = new StringBuilder()
                .append("From: <").append(from).append(">\r\n")
                .append("To: ").append(String.join(", ", to)).append("\r\n")
                .append("Subject: ").append(encodeWord(subject)).append("\r\n")
                .append("MIME-Version: 1.0\r\n")
                .append("Content-Type: multipart/mixed; boundary=\"").append(boundary).append("\"\r\n\r\n")
                .append("--").append(boundary).append("\r\n")
                .append("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
                .append("Sent from Audiohub\r\n\r\n")
                .append("--").append(boundary).append("\r\n")
                .append("Content-Type: ").append(mime).append("; name=\"").append(ascii(fileName)).append("\"\r\n")
                .append("Content-Transfer-Encoding: base64\r\n")
                .append("Content-Disposition: attachment; filename=\"").append(ascii(fileName)).append("\"; filename*=UTF-8''")
                .append(URLEncoder.encode(fileName, "UTF-8").replace("+", "%20")).append("\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.UTF_8));
            // The file, base64 in 76-character lines (57 bytes each), streamed.
            try (FileInputStream f = new FileInputStream(file)) {
                byte[] chunk = new byte[57 * 1024];
                int n;
                while ((n = readFully(f, chunk)) > 0) {
                    out.write(Base64.encode(chunk, 0, n, Base64.CRLF));
                }
            }
            out.write(("\r\n--" + boundary + "--\r\n.\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();
            expect(in, 250);
            try {
                cmd(out, in, "QUIT", -1);
            } catch (Exception ignored) {
            }
        } finally {
            s.close();
        }
    }

    private static int readFully(FileInputStream f, byte[] buf) throws Exception {
        int off = 0;
        while (off < buf.length) {
            int n = f.read(buf, off, buf.length - off);
            if (n < 0) break;
            off += n;
        }
        return off;
    }

    private static String b64(String v) {
        return Base64.encodeToString(v.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private static String ascii(String v) {
        return v.replaceAll("[^\\x20-\\x7e]", "_").replace("\"", "'");
    }

    private static String encodeWord(String v) {
        return v.matches("[\\x20-\\x7e]*") ? v : "=?UTF-8?B?" + b64(v) + "?=";
    }

    /** Send a command; check the reply code (expected < 0: return it unchecked). */
    private static int cmd(OutputStream out, BufferedReader in, String line, int expected) throws Exception {
        out.write((line + "\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        return expected < 0 ? reply(in) : expect(in, expected);
    }

    private static int expect(BufferedReader in, int code) throws Exception {
        int got = reply(in);
        if (got != code) throw new Exception(server + " answered " + got + " (" + last + ")");
        return got;
    }

    private static String last = "";

    /** One reply, which may span several "250-…" lines; returns its code. */
    private static int reply(BufferedReader in) throws Exception {
        String line;
        do {
            line = in.readLine();
            if (line == null) throw new Exception(server + " closed the connection");
        } while (line.length() > 3 && line.charAt(3) == '-');
        last = line.length() > 4 ? line.substring(4) : line;
        return Integer.parseInt(line.substring(0, 3));
    }
}

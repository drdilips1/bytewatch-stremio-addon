package org.research4life.portal;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.TimeUnit;

/**
 * On-device text recognition (ML Kit, Latin scripts) for photos of pages and scanned PDFs.
 * Returns lines with their positions so the web app can rebuild headings and paragraphs.
 * Call off the main thread.
 */
final class Ocr {

    private static TextRecognizer recognizer;

    private Ocr() {}

    private static synchronized TextRecognizer recognizer() {
        if (recognizer == null) recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        return recognizer;
    }

    /** A photo or image file (EXIF rotation is honoured). */
    static JSONObject recognize(Context ctx, File image) throws Exception {
        InputImage in = InputImage.fromFilePath(ctx, Uri.fromFile(image));
        return run(in, in.getWidth(), in.getHeight());
    }

    /** A page rendered by the web app, as JPEG/PNG bytes. */
    static JSONObject recognize(byte[] imageBytes) throws Exception {
        Bitmap bmp = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
        if (bmp == null) throw new Exception("Not an image");
        try {
            return run(InputImage.fromBitmap(bmp, 0), bmp.getWidth(), bmp.getHeight());
        } finally {
            bmp.recycle();
        }
    }

    private static JSONObject run(InputImage in, int w, int h) throws Exception {
        Text text = Tasks.await(recognizer().process(in), 90, TimeUnit.SECONDS);
        JSONArray blocks = new JSONArray();
        for (Text.TextBlock b : text.getTextBlocks()) {
            JSONArray lines = new JSONArray();
            for (Text.Line l : b.getLines()) {
                JSONObject lo = new JSONObject().put("t", l.getText());
                Rect r = l.getBoundingBox();
                if (r != null) lo.put("x", r.left).put("y", r.top).put("w", r.width()).put("h", r.height());
                lines.put(lo);
            }
            blocks.put(new JSONObject().put("lines", lines));
        }
        return new JSONObject().put("w", w).put("h", h).put("blocks", blocks);
    }
}

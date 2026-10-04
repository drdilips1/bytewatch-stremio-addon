package org.research4life.portal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.text.TextUtils;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.IOException;

/** Offline reader for PDFs in the library, with zoom and remembered reading position. */
public class PdfViewerActivity extends Activity {

    static final String EXTRA_KEY = "key";
    static final String EXTRA_TITLE = "title";

    private static final float[] ZOOMS = {1f, 1.5f, 2f, 3f};

    private PdfRenderer renderer;
    private ParcelFileDescriptor fd;
    private ListView list;
    private HorizontalScrollView hscroll;
    private TextView pageLabel;
    private String key;
    private int zoomIndex = 0;
    private int baseWidth;
    private final LruCache<Integer, Bitmap> cache = new LruCache<Integer, Bitmap>(48 * 1024 * 1024) {
        @Override
        protected int sizeOf(Integer k, Bitmap b) {
            return b.getByteCount();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        key = getIntent().getStringExtra(EXTRA_KEY);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        File file = PdfStore.file(this, key);
        try {
            fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(fd);
        } catch (IOException | SecurityException e) {
            Toast.makeText(this, "Can't open this PDF here. Try Open with…", Toast.LENGTH_LONG).show();
            openWith();
            finish();
            return;
        }
        baseWidth = getResources().getDisplayMetrics().widthPixels;
        buildUi(title == null || title.isEmpty() ? PdfStore.title(this, key) : title);

        int last = prefs().getInt(key, 0);
        if (last > 0 && last < renderer.getPageCount()) list.setSelection(last);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("pdf_positions", MODE_PRIVATE);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView button(String label, View.OnClickListener l, int fg) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(fg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(11), dp(8), dp(11), dp(8));
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true);
        b.setBackgroundResource(tv.resourceId);
        b.setOnClickListener(l);
        return b;
    }

    private void buildUi(String title) {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? Color.parseColor("#16181D") : Color.WHITE;
        int fg = night ? Color.parseColor("#E6E8EB") : Color.parseColor("#111827");
        int pageBg = night ? Color.parseColor("#0B0C0F") : Color.parseColor("#E5E7EB");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(pageBg);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(bg);
        bar.setElevation(dp(2));
        bar.setPadding(dp(4), 0, dp(4), 0);
        bar.addView(button("←", v -> finish(), fg));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(fg);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        pageLabel = new TextView(this);
        pageLabel.setTextColor(Color.parseColor("#6B7280"));
        pageLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        titles.addView(t);
        titles.addView(pageLabel);
        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        bar.addView(button("−", v -> setZoom(zoomIndex - 1), fg));
        bar.addView(button("+", v -> setZoom(zoomIndex + 1), fg));
        bar.addView(button("⇪", v -> share(), fg));
        bar.addView(button("⋯", v -> openWith(), fg));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        hscroll = new HorizontalScrollView(this);
        hscroll.setFillViewport(true);
        list = new ListView(this);
        list.setDivider(null);
        list.setDividerHeight(dp(8));
        list.setBackgroundColor(pageBg);
        list.setAdapter(adapter);
        list.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(AbsListView view, int state) {}

            @Override
            public void onScroll(AbsListView view, int first, int visible, int total) {
                pageLabel.setText("Page " + (first + 1) + " of " + total);
            }
        });
        hscroll.addView(list, new ViewGroup.LayoutParams(baseWidth, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(hscroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private void setZoom(int index) {
        if (index < 0 || index >= ZOOMS.length) return;
        int page = list.getFirstVisiblePosition();
        zoomIndex = index;
        cache.evictAll();
        ViewGroup.LayoutParams lp = list.getLayoutParams();
        lp.width = (int) (baseWidth * ZOOMS[zoomIndex]);
        list.setLayoutParams(lp);
        adapter.notifyDataSetChanged();
        list.setSelection(page);
        Toast.makeText(this, (int) (ZOOMS[zoomIndex] * 100) + "%", Toast.LENGTH_SHORT).show();
    }

    private Bitmap render(int index) {
        Bitmap cached = cache.get(index);
        if (cached != null) return cached;
        try (PdfRenderer.Page page = renderer.openPage(index)) {
            int width = (int) (baseWidth * ZOOMS[zoomIndex]);
            int height = (int) ((float) page.getHeight() / page.getWidth() * width);
            Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bmp.eraseColor(Color.WHITE);
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            cache.put(index, bmp);
            return bmp;
        }
    }

    private final BaseAdapter adapter = new BaseAdapter() {
        @Override
        public int getCount() {
            return renderer == null ? 0 : renderer.getPageCount();
        }

        @Override
        public Object getItem(int position) {
            return position;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            ImageView iv = convertView instanceof ImageView ? (ImageView) convertView : new ImageView(PdfViewerActivity.this);
            iv.setAdjustViewBounds(true);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            iv.setImageBitmap(render(position));
            return iv;
        }
    };

    private void share() {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("application/pdf");
        i.putExtra(Intent.EXTRA_STREAM, PdfStore.shareUri(this, key));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "Share PDF"));
    }

    private void openWith() {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(PdfStore.shareUri(this, key), "application/pdf");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(i, "Open with"));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No PDF app installed", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (list != null) prefs().edit().putInt(key, list.getFirstVisiblePosition()).apply();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        cache.evictAll();
        try {
            if (renderer != null) renderer.close();
            if (fd != null) fd.close();
        } catch (IOException ignored) {
        }
    }
}

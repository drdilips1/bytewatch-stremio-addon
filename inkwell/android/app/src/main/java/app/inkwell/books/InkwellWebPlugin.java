package app.inkwell.books;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens a page in the in-app browser (InkwellWebActivity). */
@CapacitorPlugin(name = "InkwellWeb")
public class InkwellWebPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("Missing url");
            return;
        }
        Intent i = new Intent(getContext(), InkwellWebActivity.class);
        i.putExtra("url", url);
        i.putExtra("title", call.getString("title", ""));
        getActivity().startActivity(i);
        call.resolve();
    }
}

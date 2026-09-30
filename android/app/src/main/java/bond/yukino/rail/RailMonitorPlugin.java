package bond.yukino.rail;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "RailMonitor")
public class RailMonitorPlugin extends Plugin {
    private static WeakReference<RailMonitorPlugin> active = new WeakReference<>(null);
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean foreground = false; private volatile boolean tickChecking = false;
    private final Runnable tick = new Runnable() { @Override public void run() {
        if (!foreground) return;
        if (!tickChecking && RailMonitorEngine.due(getContext())) { tickChecking = true; executor.execute(() -> { try { RailMonitorEngine.check(getContext(), null, true); } catch (Exception ignored) {} finally { tickChecking = false; } }); }
        handler.postDelayed(this, 15000);
    }};
    @Override public void load() { active = new WeakReference<>(this); foreground = true; handler.post(tick); }
    static void publish(Context context) {
        RailMonitorPlugin plugin = active.get(); if (plugin == null) return;
        try { JSObject state = new JSObject(RailMonitorEngine.snapshot(context).toString()); plugin.handler.post(() -> plugin.notifyListeners("state", state)); } catch (Exception ignored) {}
    }
    @PluginMethod public void getState(PluginCall call) { try { call.resolve(new JSObject(RailMonitorEngine.snapshot(getContext()).toString())); } catch (Exception error) { call.reject(error.getMessage()); } }
    @PluginMethod public void configure(PluginCall call) { try {
        JSONObject value = call.getObject("settings"); if (value == null) throw new Exception("无效查询设置");
        call.resolve(new JSObject(RailMonitorEngine.configure(getContext(), value).toString()));
    } catch (Exception error) { call.reject(error.getMessage()); } }
    @PluginMethod public void checkNow(PluginCall call) { executor.execute(() -> { try {
        JSONObject value = call.getObject("settings"); if (value == null) throw new Exception("无效查询设置");
        call.resolve(new JSObject(RailMonitorEngine.check(getContext(), value, false).toString()));
    } catch (Exception error) { call.reject(error.getMessage()); } }); }
    @PluginMethod public void stations(PluginCall call) { executor.execute(() -> { try { call.resolve(new JSObject(RailMonitorEngine.request("?mode=stations").toString())); } catch (Exception error) { call.reject(error.getMessage()); } }); }
    @Override protected void handleOnPause() { foreground = false; handler.removeCallbacks(tick); }
    @Override protected void handleOnResume() { foreground = true; handler.removeCallbacks(tick); handler.post(tick); publish(getContext()); }
    @Override protected void handleOnDestroy() { foreground = false; handler.removeCallbacks(tick); executor.shutdown(); if (active.get() == this) active.clear(); }
}

package bond.yukino.rail;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.locks.ReentrantLock;

final class RailMonitorEngine {
    static final String API = "https://www.yukino.bond/api/rail";
    static final String CHANNEL = "rail-availability";
    private static final Object STATE_LOCK = new Object();
    private static final ReentrantLock QUERY_LOCK = new ReentrantLock();
    private static volatile boolean checking = false;
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("rail-monitor", Context.MODE_PRIVATE); }
    static JSONObject defaults() throws Exception {
        SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT); date.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        return new JSONObject().put("queryMode", "train").put("date", date.format(new Date())).put("train", "").put("from", "").put("to", "").put("seat", "任意席别").put("intervalMinutes", 5).put("enabled", false);
    }
    static JSONObject settings(Context context) throws Exception { return new JSONObject(prefs(context).getString("settings", defaults().toString())); }
    static JSONObject snapshot(Context context) throws Exception {
        SharedPreferences store = prefs(context);
        String result = store.getString("result", null), error = store.getString("error", null);
        return new JSONObject().put("settings", settings(context)).put("result", result == null ? JSONObject.NULL : new JSONObject(result)).put("error", error == null ? JSONObject.NULL : error).put("checking", checking);
    }
    static JSONObject validate(JSONObject input) throws Exception {
        JSONObject next = defaults();
        for (String field : new String[]{"queryMode", "date", "train", "from", "to", "seat"}) next.put(field, input.optString(field, next.getString(field)).trim());
        next.put("train", next.getString("train").toUpperCase(Locale.ROOT));
        double interval = input.optDouble("intervalMinutes", 5);
        if (input.optBoolean("enabled", false) && (interval < 1 || interval > 60 || interval != Math.floor(interval) || !next.getString("date").matches("\\d{4}-\\d{2}-\\d{2}") || !next.getString("queryMode").matches("train|route"))) throw new Exception("请填写有效日期和 1–60 分钟的间隔");
        next.put("intervalMinutes", (int) interval).put("enabled", input.optBoolean("enabled", false));
        if (next.getBoolean("enabled") && !validQuery(next)) throw new Exception("请先填写车次或两个不同的车站");
        return next;
    }
    private static boolean validQuery(JSONObject settings) throws Exception {
        return settings.getString("queryMode").equals("train") ? settings.getString("train").matches("(?:[GDCZTKYS]\\d{1,4}[A-Z]?|\\d{4})") : !settings.getString("from").isEmpty() && !settings.getString("to").isEmpty() && !settings.getString("from").equals(settings.getString("to"));
    }
    static JSONObject configure(Context context, JSONObject input) throws Exception {
        JSONObject next = validate(input);
        synchronized (STATE_LOCK) {
            SharedPreferences store = prefs(context);
            store.edit().putString("settings", next.toString()).putLong("revision", store.getLong("revision", 0) + 1).remove("result").remove("error").remove("availability").remove("checkedMs").apply();
        }
        RailMonitorWorker.schedule(context, next);
        RailMonitorPlugin.publish(context);
        return snapshot(context);
    }
    static JSONObject request(String query) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) URI.create(API + query).toURL().openConnection();
        connection.setConnectTimeout(12000); connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "YukinoRailMobile/1.0.0 (Android)");
        try {
            int status = connection.getResponseCode();
            try (InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (stream == null) throw new Exception("查询服务暂不可用（" + status + "）");
                byte[] buffer = new byte[8192]; int count;
                while ((count = stream.read(buffer)) != -1) { if (out.size() + count > 4 * 1024 * 1024) throw new Exception("查询结果过大"); out.write(buffer, 0, count); }
                JSONObject result = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
                if (status < 200 || status >= 300) throw new Exception(result.optString("error", "查询服务暂不可用（" + status + "）"));
                return result;
            }
        } finally { connection.disconnect(); }
    }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()); }
    static JSONObject check(Context context, JSONObject supplied, boolean notify) throws Exception {
        QUERY_LOCK.lock();
        long revision = -1;
        try {
            JSONObject selected;
            synchronized (STATE_LOCK) {
                selected = supplied == null ? settings(context) : validate(supplied);
                if (supplied == null && !selected.getBoolean("enabled")) return null;
                if (!validQuery(selected)) throw new Exception("请填写有效车次或区间");
                revision = prefs(context).getLong("revision", 0); checking = true;
            }
            RailMonitorPlugin.publish(context);
            String query = "?date=" + encode(selected.getString("date")) + "&search=" + selected.getString("queryMode");
            query += selected.getString("queryMode").equals("train") ? "&train=" + encode(selected.getString("train")) : "&from=" + encode(selected.getString("from")) + "&to=" + encode(selected.getString("to"));
            JSONObject result = request(query);
            if (!(result.opt("trains") instanceof JSONArray)) throw new Exception("查询结果格式不正确");
            synchronized (STATE_LOCK) {
                SharedPreferences store = prefs(context);
                if (revision != store.getLong("revision", 0)) return result;
                store.edit().putString("result", result.toString()).putLong("checkedMs", System.currentTimeMillis()).remove("error").apply();
                if (notify && settings(context).optBoolean("enabled")) notifyChanges(context, selected, result);
            }
            return result;
        } catch (Exception error) {
            synchronized (STATE_LOCK) { if (revision == prefs(context).getLong("revision", 0)) prefs(context).edit().putString("error", error.getMessage()).apply(); }
            throw error;
        } finally { checking = false; QUERY_LOCK.unlock(); RailMonitorPlugin.publish(context); }
    }
    static boolean due(Context context) {
        try { JSONObject settings = settings(context); return settings.optBoolean("enabled") && System.currentTimeMillis() - prefs(context).getLong("checkedMs", 0) >= settings.getInt("intervalMinutes") * 60000L; } catch (Exception ignored) { return false; }
    }
    private static void notifyChanges(Context context, JSONObject settings, JSONObject result) throws Exception {
        JSONObject previous = new JSONObject(prefs(context).getString("availability", "{}")), current = new JSONObject();
        JSONArray trains = result.getJSONArray("trains");
        for (int i = 0; i < trains.length(); i++) {
            JSONObject train = trains.getJSONObject(i); JSONArray seats = train.getJSONArray("seats"); StringBuilder detail = new StringBuilder();
            for (int j = 0; j < seats.length(); j++) { JSONObject seat = seats.getJSONObject(j); if (seat.optBoolean("available") && (settings.getString("seat").equals("任意席别") || settings.getString("seat").equals(seat.optString("label")))) { if (detail.length() > 0) detail.append(" · "); detail.append(seat.optString("label")).append(' ').append(seat.optString("value")); } }
            String key = settings.getString("date") + "/" + train.getString("code"); boolean available = detail.length() > 0; current.put(key, available);
            if (available && !previous.optBoolean(key)) sendNotification(context, key, train.getString("code") + " 有余票", settings.getString("date") + " " + train.optString("from") + " → " + train.optString("to") + " · " + detail);
        }
        prefs(context).edit().putString("availability", current.toString()).apply();
    }
    private static void sendNotification(Context context, String key, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "余票提醒", NotificationManager.IMPORTANCE_DEFAULT));
        Intent intent = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_rail).setColor(0xff315c42).setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(tap).setAutoCancel(true);
        NotificationManagerCompat.from(context).notify(key, 1, notification.build());
    }
}

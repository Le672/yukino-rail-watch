package bond.yukino.rail;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

public class RailMonitorWorker extends Worker {
    public RailMonitorWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        try { RailMonitorEngine.check(getApplicationContext(), null, true); return Result.success(); }
        catch (Exception ignored) { return getRunAttemptCount() < 3 ? Result.retry() : Result.failure(); }
    }
    static void schedule(Context context, JSONObject settings) {
        WorkManager manager = WorkManager.getInstance(context);
        if (!settings.optBoolean("enabled")) { manager.cancelUniqueWork("rail-periodic"); manager.cancelUniqueWork("rail-first-check"); return; }
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        manager.enqueueUniquePeriodicWork("rail-periodic", ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE,
            new PeriodicWorkRequest.Builder(RailMonitorWorker.class, Math.max(15, settings.optInt("intervalMinutes", 5)), TimeUnit.MINUTES).setInitialDelay(15, TimeUnit.MINUTES).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES).build());
        manager.enqueueUniqueWork("rail-first-check", ExistingWorkPolicy.REPLACE,
            new OneTimeWorkRequest.Builder(RailMonitorWorker.class).setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES).build());
    }
}

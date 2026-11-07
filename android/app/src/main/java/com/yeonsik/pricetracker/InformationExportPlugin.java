package com.yeonsik.pricetracker;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** User-chosen SAF export only. Never parses or rewrites the record's JSON. */
@CapacitorPlugin(name = "InformationExport")
public class InformationExportPlugin extends Plugin {
    @PluginMethod public void saveRecord(PluginCall call) {
        String text = call.getString("text");
        String filename = call.getString("filename");
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 1_048_576 ||
            filename == null || !filename.matches("[0-9a-f-]{36}\\.information-record\\.json")) {
            call.reject("내보낼 기록의 이름 또는 크기를 확인하세요.");
            return;
        }
        File pending = null;
        try {
            pending = File.createTempFile("information-export-", ".json", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(pending)) {
                output.write(text.getBytes(StandardCharsets.UTF_8)); output.getFD().sync();
            }
            // Activity state must not carry a 1 MiB payload across Android's Binder limit.
            call.getData().remove("text");
            call.getData().put("pendingFile", pending.getName());
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(call, intent, "recordCreated");
        } catch (Exception failure) {
            if (pending != null) pending.delete();
            call.reject("파일 저장 창을 열지 못했습니다.", failure);
        }
    }

    @ActivityCallback private void recordCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String name = call.getString("pendingFile");
        if (name == null || !name.matches("information-export-[A-Za-z0-9_-]+\\.json")) {
            call.reject("임시 내보내기 파일을 찾지 못했습니다. 다시 시도하세요."); return;
        }
        File pending = new File(getContext().getCacheDir(), name);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            pending.delete(); call.reject("내보내기를 취소했습니다.", "CANCELLED"); return;
        }
        getBridge().execute(() -> {
            try (FileInputStream input = new FileInputStream(pending);
                 OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "w")) {
                if (output == null) throw new java.io.IOException("No output stream");
                byte[] buffer = new byte[64 * 1024]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            } catch (Exception failure) {
                call.reject("선택한 파일에 쓰지 못했습니다. 저장 위치를 확인하세요.", failure); return;
            } finally { pending.delete(); }
            call.resolve();
        });
    }
}

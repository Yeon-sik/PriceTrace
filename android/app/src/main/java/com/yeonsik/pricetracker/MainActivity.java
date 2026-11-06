package com.yeonsik.pricetracker;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InformationExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

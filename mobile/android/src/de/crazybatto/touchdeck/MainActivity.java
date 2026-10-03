package de.crazybatto.touchdeck;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayInputStream;

/** A single system WebView, no service, no JS bridge, no camera or microphone. */
public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private LinearLayout root, content;
    private TextView notice;
    private String address;
    private boolean loadFailed;
    private Runnable timeout;
    private static final int BG = Color.rgb(17,17,15), GOLD = Color.rgb(214,184,112), TEXT = Color.rgb(242,234,215);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        CookieManager.getInstance().setAcceptCookie(false);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view,insets)->{
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets edges = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root); showConnection("");
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->{if(web!=null)disconnectAndReturn();else finish();});
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value,int size,int color) { TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setPadding(0,dp(8),0,dp(8));return view; }
    private Button button(String title) { Button button=new Button(this);button.setText(title);button.setTextColor(TEXT);button.setAllCaps(false);button.setMinHeight(dp(48));return button; }
    private void stopTimeout() { if(timeout!=null)handler.removeCallbacks(timeout);timeout=null; }
    private void disposeWeb() {
        stopTimeout(); if(web==null)return;
        WebView previous=web;web=null;previous.stopLoading();
        if(previous.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)previous.getParent()).removeView(previous);
        previous.loadUrl("about:blank");previous.clearHistory();previous.destroy();
    }
    private void showConnection(String message) {
        disposeWeb(); root.removeAllViews();
        ScrollView scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(24),dp(24),dp(24),dp(24));scroll.addView(content);root.addView(scroll);
        content.addView(text("BATTO 3-IN-1",12,GOLD)); content.addView(text("Touch Deck",30,TEXT));
        content.addView(text("Deine Tasten auf Handy und Tablet",18,GOLD));
        content.addView(text("Am PC: Touch Deck → Handy / Tablet einschalten. Gib hier die dort angezeigte PC-Adresse ein. Beide Geräte müssen im selben privaten WLAN sein.",16,TEXT));
        content.addView(text("PC-Adresse",14,GOLD));
        EditText input=new EditText(this);input.setTextColor(TEXT);input.setHintTextColor(Color.GRAY);input.setSingleLine(true);input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);input.setHint("192.168.1.20:17660");input.setText(getPreferences(MODE_PRIVATE).getString("address",""));content.addView(input);
        Button connect=button("Mit PC verbinden");content.addView(connect);
        TextView error=text(message,15,Color.rgb(255,181,169));content.addView(error);
        connect.setOnClickListener(view->{String parsed=DeckAddress.normalize(input.getText().toString());if(parsed==null){error.setText("Bitte die private IPv4-Adresse aus Batto eingeben, zum Beispiel 192.168.1.20:17660.");return;}getPreferences(MODE_PRIVATE).edit().putString("address",parsed).apply();openDeck(parsed);});
        content.addView(text("Die PIN gibst du anschließend auf der Verbindungsseite ein. Tasten und Icons kommen direkt von deinem PC. Hoch- und Querformat werden unterstützt.",14,TEXT));
        content.addView(text("Version 1.7.0 · Keine Hintergrundübertragung, wenn die App nicht sichtbar ist.",12,GOLD));
    }
    private void openDeck(String url) {
        View focused=getCurrentFocus();if(focused!=null)((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(focused.getWindowToken(),0);
        disposeWeb(); address=url;root.removeAllViews();
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(dp(10),0,dp(10),0);
        TextView title=text("Batto Touch Deck",16,GOLD);bar.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        Button change=button("PC wechseln");change.setTextSize(12);change.setOnClickListener(view->disconnectAndReturn());bar.addView(change);root.addView(bar);
        notice=text("Verbindung wird aufgebaut …",14,GOLD);notice.setPadding(dp(14),dp(6),dp(14),dp(6));root.addView(notice);
        web=new WebView(this);web.setBackgroundColor(BG);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(true);settings.setGeolocationEnabled(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setUserAgentString(settings.getUserAgentString()+" BattoTouchDeck/1.7.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(DeckAddress.sameOrigin(address,request.getUrl().toString()))return false;
                if(request.isForMainFrame() && request.hasGesture() && "https".equals(request.getUrl().getScheme()) && "github.com".equals(request.getUrl().getHost()) && request.getUrl().getPath().startsWith("/dannymeienbrock99-prog/3-in-1-/releases/")){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()));}catch(Exception unavailable){notice.setVisibility(View.VISIBLE);notice.setText("Kein Browser zum Öffnen des Downloads verfügbar.");}
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(DeckAddress.sameOrigin(address,request.getUrl().toString()))return null;
                return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){loadFailed=false;stopTimeout();notice.setText("Verbindung wird aufgebaut …");notice.setVisibility(View.VISIBLE);timeout=()->connectionError();handler.postDelayed(timeout,15000);}
            @Override public void onPageFinished(WebView view,String url){stopTimeout();if(!loadFailed)notice.setVisibility(View.GONE);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())connectionError();}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame())connectionError();}
        });
        root.addView(web,new LinearLayout.LayoutParams(-1,0,1));web.loadUrl(url);
    }
    private void connectionError(){if(loadFailed||web==null)return;loadFailed=true;stopTimeout();handler.post(()->showConnection("PC nicht erreichbar. Prüfe Batto, die PC-Adresse, WLAN und die Freigabe im privaten Windows-Netzwerk. Danach erneut verbinden."));}
    private void disconnectAndReturn(){
        if(web==null){showConnection("");return;}
        web.evaluateJavascript("document.getElementById('disconnect')?.click();sessionStorage.removeItem('batto-touch-session');",null);
        handler.postDelayed(()->showConnection("Verbindung getrennt."),250);
    }
    @Override public void onBackPressed(){if(web!=null)disconnectAndReturn();else super.onBackPressed();}
    @Override public void onPause(){if(web!=null){web.evaluateJavascript("window.dispatchEvent(new Event('batto:suspend'));",null);web.onPause();web.pauseTimers();}super.onPause();}
    @Override public void onResume(){super.onResume();if(web!=null){web.resumeTimers();web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('batto:resume'));",null);}}
    @Override public void onDestroy(){disposeWeb();handler.removeCallbacksAndMessages(null);super.onDestroy();}
}

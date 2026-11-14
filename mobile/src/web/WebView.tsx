// react-native-webview 14.0.1-ийн төрлүүд RN 0.88-тай нийлэхэд iOS/Android props-ийн огтлолцол `never` болдог
// (зөвхөн TypeScript-ийн асуудал, ажиллахад нөлөөгүй). Бидний ашигладаг props-оор төрлийг нь тодорхойлов.
import type { ComponentType, Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

export type WebViewRef = {
  injectJavaScript(script: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stopLoading(): void;
};

type Props = {
  ref?: Ref<WebViewRef>;
  source: { uri: string } | { html: string; baseUrl?: string };
  style?: StyleProp<ViewStyle>;
  originWhitelist?: string[];
  injectedJavaScript?: string;
  injectedJavaScriptBeforeContentLoaded?: string;
  onMessage?: (e: WebViewMessageEvent) => void;
  onLoadEnd?: () => void;
  onNavigationStateChange?: (n: WebViewNavigation) => void;
  setSupportMultipleWindows?: boolean;
  allowsBackForwardNavigationGestures?: boolean;
  allowsInlineMediaPlayback?: boolean;
  mediaPlaybackRequiresUserAction?: boolean;
  pullToRefreshEnabled?: boolean;
  sharedCookiesEnabled?: boolean;
  thirdPartyCookiesEnabled?: boolean;
  domStorageEnabled?: boolean;
  decelerationRate?: "normal" | "fast" | number;
};

export const WebView = RNWebView as unknown as ComponentType<Props>;
export type { WebViewMessageEvent };

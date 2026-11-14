// Safari-д Share → «Хэлмэрчээр орчуулах» дарахад Safari энэ файлын run()-ийг хуудсан дотор ажиллуулна:
// сонгосон текст (сонгоогүй бол хуудасны гарчиг) Swift руу очно.
var HelmerchAction = function() {};
HelmerchAction.prototype = {
  run: function(args) {
    var sel = "";
    try { sel = String(window.getSelection() || ""); } catch (e) {}
    args.completionFunction({ selection: sel, title: document.title || "", url: location.href || "" });
  },
  finalize: function(args) {}
};
var ExtensionPreprocessingJS = new HelmerchAction;

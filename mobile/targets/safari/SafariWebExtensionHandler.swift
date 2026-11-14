import SafariServices
import os.log

// Хэлмэрчийн Safari өргөтгөл native мессеж ашиглахгүй (бүх логик JavaScript-д) — хүлээн авсныг л буцаана.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]

        let response = NSExtensionItem()
        response.userInfo = [ SFExtensionMessageKey: [ "ok": true, "echo": message ?? NSNull() ] ]

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}

function doPost(event) {
  try {
    var requestBody = event && event.postData && event.postData.contents;
    var payload = JSON.parse(requestBody || "{}");
    var expectedSecret = PropertiesService.getScriptProperties().getProperty("GMAIL_RELAY_SECRET");
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return jsonResponse({ sent: false, message: "Unauthorized relay request." });
    }

    var recipient = String(payload.to || "").trim();
    var subject = String(payload.subject || "").trim();
    var html = String(payload.html || "");
    var allowedSubject = subject === "Verify your Hustle254 email"
      || subject === "Reset your Hustle254 password";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) {
      return jsonResponse({ sent: false, message: "Invalid recipient address." });
    }
    if (!allowedSubject || !html || html.length > 20000) {
      return jsonResponse({ sent: false, message: "Invalid email payload." });
    }

    MailApp.sendEmail({
      to: recipient,
      subject,
      body: "This email contains an account action for Hustle254. Open it in an HTML-capable email client.",
      htmlBody: html,
      name: "Hustle254",
    });
    return jsonResponse({ sent: true });
  } catch (error) {
    console.error("Gmail relay failed: " + error.message);
    return jsonResponse({ sent: false, message: "Gmail could not send the email." });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
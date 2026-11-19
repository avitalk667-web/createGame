using System.Net;

namespace PortalX.Server.Mail;

/// <param name="Website">A hidden field people never see: a value here means a bot filled the form.</param>
public sealed record ContactRequest(string? Name, string? Email, string? Message, string? Website = null);

/// <summary>
/// The contact window ("נשמח לשמוע מכם"): one message goes to the site's contact address through the same sender as the
/// results emails, with the visitor's address as Reply-To. Checked here whatever the browser said, and rate limited.
/// </summary>
public static class ContactEndpoints
{
    public const int NameMax = 80;
    public const int MessageMin = 5;
    public const int MessageMax = 4000;

    public static void MapContactEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/contact", async (ContactRequest body, SiteOptions site, IEmailSender sender, ILoggerFactory log) =>
        {
            var name = Clean(body.Name);
            var email = ResultsEmailService.NormalizeEmail(body.Email);
            var message = body.Message?.Replace("\r\n", "\n").Trim() ?? "";

            if (name.Length < 2 || name.Length > NameMax)
                return Bad("name", $"נא לכתוב שם (עד {NameMax} תווים).");
            if (email == null)
                return Bad("email", "כתובת המייל לחזרה אינה תקינה.");
            if (message.Length < MessageMin)
                return Bad("message", "נא לכתוב הודעה.");
            if (message.Length > MessageMax)
                return Bad("message", $"ההודעה ארוכה מדי (עד {MessageMax} תווים).");

            // a bot: answer as if it worked, send nothing
            if (!string.IsNullOrWhiteSpace(body.Website)) return Results.Ok(new { ok = true, message = Sent });

            if (!await sender.IsAvailableAsync())
                return Results.Json(new ApiError("unavailable", $"שליחת הודעות אינה זמינה כרגע. אפשר לכתוב לנו ישירות לכתובת {site.ContactEmail}."), statusCode: 503);

            try
            {
                await sender.SendAsync(Build(site.ContactEmail, name, email, message));
                return Results.Ok(new { ok = true, message = Sent });
            }
            catch (EmailSendException ex)
            {
                log.CreateLogger("Contact").LogWarning("Contact message not sent ({Code})", ex.Code);
                return Results.Json(new ApiError("send-failed", $"לא הצלחנו לשלוח את ההודעה. נסו שוב בעוד כמה דקות, או כתבו לנו לכתובת {site.ContactEmail}."), statusCode: 502);
            }
        }).RequireRateLimiting("contact");
    }

    public const string Sent = "ההודעה נשלחה. תודה! נחזור אליכם במייל.";

    private static IResult Bad(string field, string text) => Results.Json(new ApiError("bad-" + field, text), statusCode: 400);

    /// <summary>One line, no control characters: the name also goes into the subject.</summary>
    private static string Clean(string? s) =>
        new string((s ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();

    public static EmailMessage Build(string to, string name, string email, string message)
    {
        string E(string s) => WebUtility.HtmlEncode(s);
        var subject = $"פנייה מהאתר — {name}";
        var html = $"""
<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;">
  <p style="margin:0 0 12px;"><strong>פנייה חדשה מחלון &quot;צור קשר&quot; באתר PORTAL X</strong></p>
  <p style="margin:0;"><strong>שם:</strong> {E(name)}</p>
  <p style="margin:0 0 12px;"><strong>מייל לחזרה:</strong> <span dir="ltr">{E(email)}</span></p>
  <div style="white-space:pre-wrap;border-right:3px solid #c9a227;padding:8px 12px;background:#faf8f3;">{E(message)}</div>
  <p style="margin:12px 0 0;color:#777;font-size:13px;">אפשר להשיב ישירות למייל הזה — התשובה תגיע אל {E(email)}.</p>
</div>
""";
        var text = $"פנייה חדשה מחלון \"צור קשר\" באתר PORTAL X\n\nשם: {name}\nמייל לחזרה: {email}\n\n{message}\n";
        return new EmailMessage(to, subject, html, text, ReplyTo: email);
    }
}

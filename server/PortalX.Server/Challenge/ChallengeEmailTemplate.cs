using System.Globalization;
using System.Text;
using static System.Net.WebUtility;

namespace PortalX.Server.Challenge;

/// <summary>What the coupon email says; every value comes from the stored coupon and campaign.</summary>
public sealed record ChallengeEmailModel(
    string Code, decimal DiscountPercent, DateTime ExpiresAtUtc, int ValidityDays, int ScoreAbove, string SiteUrl, string ContactEmail,
    string? UnsubscribeUrl);

/// <summary>
/// The personal coupon email (a service email: it carries the coupon the player asked for). Table layout, inline styles,
/// right-to-left Hebrew, no images, and a plain text twin — like the results email. No seasonal or holiday wording.
/// </summary>
public static class ChallengeEmailTemplate
{
    private const string Navy = "#0a1230";
    private const string Gold = "#e0b95c";
    private const string GoldLight = "#f6d78d";
    private const string Ink = "#1b2238";
    private const string Paper = "#ffffff";
    private const string Font = "Arial,'Segoe UI',Helvetica,sans-serif";
    private const string MobileCss = "<style>@media only screen and (max-width: 620px) { .container { width:100% !important; } .px { padding-left:16px !important; padding-right:16px !important; } }</style>";

    public const string Subject = "הצלחתם באתגר PORTAL X! הקופון שלכם מחכה לכם!";

    private static string Pct(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture) + "%";

    /// <summary>The link that opens the games; the site keeps the code for this visit and fills it in on the game page.</summary>
    public static string GamesUrl(ChallengeEmailModel m) => $"{m.SiteUrl.TrimEnd('/')}/?coupon={Uri.EscapeDataString(m.Code)}#games";

    public static string Html(ChallengeEmailModel m)
    {
        string E(string s) => HtmlEncode(s);
        var expiry = ChallengeRules.FormatIsrael(m.ExpiresAtUtc);
        var h = new StringBuilder();
        h.Append($"""
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>{E(Subject)}</title>
{MobileCss}
</head>
<body style="margin:0;padding:0;background:{Navy};" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{Navy};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:8px 0 18px;font-family:{Font};font-size:30px;font-weight:bold;letter-spacing:4px;color:{GoldLight};" dir="ltr">PORTAL X</td></tr>
<tr><td class="px" style="background:{Paper};border-radius:16px;border-top:4px solid {Gold};padding:28px 32px;font-family:{Font};color:{Ink};text-align:right;" dir="rtl">
  <h1 style="margin:0 0 10px;font-size:28px;line-height:1.3;color:{Navy};">כל הכבוד!</h1>
  <p style="margin:0 0 8px;font-size:17px;line-height:1.6;">הצלחתם לצבור יותר מ-{m.ScoreAbove} נקודות במשחק החינמי של PORTAL X.</p>
  <p style="margin:0 0 18px;font-size:17px;line-height:1.6;">הגעתם להישג מיוחד וקיבלתם הטבה!</p>
  <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:{Navy};">קוד הקופון האישי שלכם:</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td align="center" style="background:{Navy};border:2px dashed {Gold};border-radius:14px;padding:18px 10px;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:3px;color:#ffffff;" dir="ltr">{E(m.Code)}</td></tr></table>
  <p style="margin:0 0 14px;font-size:20px;font-weight:bold;color:#7a5a12;text-align:center;">{Pct(m.DiscountPercent)} הנחה על רכישת אחד ממשחקי PORTAL X</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:#fff6dc;border-right:4px solid {Gold};border-radius:10px;"><tr><td style="padding:12px 14px;font-family:{Font};font-size:16px;color:{Ink};">
    <b>תוקף הקופון עד:</b> <span dir="rtl" style="font-weight:bold;color:{Navy};">{E(expiry)}</span> (שעון ישראל)
  </td></tr></table>
  <p style="margin:0 0 6px;font-size:15px;line-height:1.6;">הקופון אישי וניתן למימוש פעם אחת בלבד.</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.6;font-weight:bold;">אל תחכו לרגע האחרון – ההטבה מוגבלת ל-{m.ValidityDays} ימים!</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="border-radius:999px;background:{Gold};">
    <a href="{E(GamesUrl(m))}" style="display:inline-block;padding:14px 32px;font-family:{Font};font-size:17px;font-weight:bold;color:#2a1606;text-decoration:none;border-radius:999px;">לצפייה במשחקים ולרכישה</a>
  </td></tr></table>
</td></tr>
<tr><td style="padding:18px 16px 6px;font-family:{Font};font-size:12px;line-height:1.7;color:#aab4d4;text-align:right;" dir="rtl">
  <b>תנאי השימוש בקופון:</b> הקופון מעניק {Pct(m.DiscountPercent)} הנחה על רכישה אחת של אחד ממשחקי PORTAL X המשתתפים בהטבה. הקופון אישי, אינו ניתן להעברה, ניתן למימוש פעם אחת בלבד ואינו ניתן להמרה בכסף. ההנחה מחושבת במעמד התשלום. תוקף הקופון עד {E(expiry)} (שעון ישראל); לאחר מועד זה לא ניתן לממש אותו. תשלום שלא הושלם אינו מנצל את הקופון.<br>
  PORTAL X · חדרי בריחה וירטואליים · <a href="{E(m.SiteUrl)}" style="color:{GoldLight};">{E(m.SiteUrl.Replace("https://", "").TrimEnd('/'))}</a> · לפניות: <a href="mailto:{E(m.ContactEmail)}" style="color:{GoldLight};">{E(m.ContactEmail)}</a>
""");
        if (m.UnsubscribeUrl != null)
            h.Append($"""<br>קיבלתם את המייל הזה כי ביקשתם את הקופון. <a href="{E(m.UnsubscribeUrl)}" style="color:{GoldLight};">להסרה מרשימת הדיוור השיווקי</a>""");
        h.Append("""
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
""");
        return h.ToString();
    }

    public static string Text(ChallengeEmailModel m)
    {
        var expiry = ChallengeRules.FormatIsrael(m.ExpiresAtUtc);
        var t = new StringBuilder();
        t.AppendLine("כל הכבוד!");
        t.AppendLine();
        t.AppendLine($"הצלחתם לצבור יותר מ-{m.ScoreAbove} נקודות במשחק החינמי של PORTAL X.");
        t.AppendLine("הגעתם להישג מיוחד וקיבלתם הטבה!");
        t.AppendLine();
        t.AppendLine("קוד הקופון האישי שלכם:");
        t.AppendLine(m.Code);
        t.AppendLine();
        t.AppendLine($"{Pct(m.DiscountPercent)} הנחה על רכישת אחד ממשחקי PORTAL X.");
        t.AppendLine();
        t.AppendLine("תוקף הקופון עד:");
        t.AppendLine($"{expiry} (שעון ישראל)");
        t.AppendLine();
        t.AppendLine("הקופון אישי וניתן למימוש פעם אחת בלבד.");
        t.AppendLine($"אל תחכו לרגע האחרון – ההטבה מוגבלת ל-{m.ValidityDays} ימים!");
        t.AppendLine();
        t.AppendLine("לצפייה במשחקים ולרכישה: " + GamesUrl(m));
        t.AppendLine();
        t.AppendLine("---");
        t.AppendLine($"תנאי השימוש: הקופון אישי, ניתן למימוש פעם אחת בלבד על אחד ממשחקי PORTAL X המשתתפים בהטבה, ותקף עד {expiry} (שעון ישראל). תשלום שלא הושלם אינו מנצל את הקופון.");
        t.AppendLine($"PORTAL X · חדרי בריחה וירטואליים · {m.SiteUrl} · {m.ContactEmail}");
        if (m.UnsubscribeUrl != null) t.AppendLine("להסרה מרשימת הדיוור השיווקי: " + m.UnsubscribeUrl);
        return t.ToString();
    }
}

using System.Text;
using static System.Net.WebUtility;

namespace PortalX.Server.Referrals;

public sealed record ReferralEmailModel(string FirstName, string LinkUrl, string SiteUrl, string ContactEmail, string? UnsubscribeUrl);

/// <summary>
/// The personal-link email: the same look as the results email (table layout, inline styles, right-to-left Hebrew, no
/// images) and a plain text twin. It holds the recipient's own link only — nothing about anyone else.
/// </summary>
public static class ReferralEmailTemplate
{
    public const string Subject = "הקישור האישי שלך ל-PORTAL X מוכן!";
    private const string Navy = "#0a1230";
    private const string Gold = "#e0b95c";
    private const string GoldLight = "#f6d78d";
    private const string Ink = "#1b2238";
    private const string Paper = "#ffffff";
    private const string Font = "Arial,'Segoe UI',Helvetica,sans-serif";
    private const string MobileCss = "<style>@media only screen and (max-width: 620px) { .container { width:100% !important; } .px { padding-left:16px !important; padding-right:16px !important; } }</style>";

    public static string Html(ReferralEmailModel m)
    {
        string E(string s) => HtmlEncode(s);
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
  <h1 style="margin:0 0 14px;font-size:26px;line-height:1.3;color:{Navy};">שלום {E(m.FirstName)},</h1>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">הקישור השיווקי האישי שלך ל־PORTAL X מוכן.</p>
  <p style="margin:0 0 12px;font-size:16px;line-height:1.7;">אפשר לשתף את הקישור עם חברים ומכרים, ולעזור להם לגלות את משחקי הבריחה של PORTAL X.</p>
  <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">רכישות מתאימות שיתבצעו דרך הקישור יופיעו בנתוני הקישור האישי.</p>
  <p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:{Navy};">הקישור האישי שלך:</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
    <td style="padding:14px 16px;background:#fff6dc;border:1px dashed {Gold};border-radius:10px;font-family:'Courier New',monospace;font-size:15px;color:{Navy};word-break:break-all;" dir="ltr" align="left">
      <a href="{E(m.LinkUrl)}" style="color:{Navy};text-decoration:none;">{E(m.LinkUrl)}</a>
    </td>
  </tr></table>
  <p style="margin:0 0 20px;font-size:14px;color:#5b6480;">כדי להעתיק: לחיצה ארוכה על הקישור (בטלפון) או סימון והעתקה (במחשב).</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="border-radius:999px;background:{Gold};">
    <a href="{E(m.LinkUrl)}" style="display:inline-block;padding:14px 32px;font-family:{Font};font-size:17px;font-weight:bold;color:#2a1606;text-decoration:none;border-radius:999px;">פתיחת האתר דרך הקישור</a>
  </td></tr></table>
  <p style="margin:22px 0 0;font-size:16px;line-height:1.7;">תודה שהצטרפת ל־PORTAL X!</p>
</td></tr>
<tr><td align="center" style="padding:20px 12px 6px;font-family:{Font};font-size:13px;line-height:1.7;color:#c9d2ee;" dir="rtl">
  קיבלת את המייל הזה כי יצרת קישור אישי באתר PORTAL X.<br>
  יצירת קשר: <a href="mailto:{E(m.ContactEmail)}" style="color:{GoldLight};" dir="ltr">{E(m.ContactEmail)}</a> · <a href="{E(m.SiteUrl)}" style="color:{GoldLight};">PORTAL X</a>
""");
        if (m.UnsubscribeUrl != null)
            h.Append($"""<br><a href="{E(m.UnsubscribeUrl)}" style="color:#c9d2ee;text-decoration:underline;">להסרה מרשימת הדיוור</a>""");
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

    public static string Text(ReferralEmailModel m)
    {
        var t = new StringBuilder();
        t.AppendLine("PORTAL X");
        t.AppendLine($"שלום {m.FirstName},");
        t.AppendLine();
        t.AppendLine("הקישור השיווקי האישי שלך ל-PORTAL X מוכן.");
        t.AppendLine("אפשר לשתף את הקישור עם חברים ומכרים, ולעזור להם לגלות את משחקי הבריחה של PORTAL X.");
        t.AppendLine("רכישות מתאימות שיתבצעו דרך הקישור יופיעו בנתוני הקישור האישי.");
        t.AppendLine();
        t.AppendLine("הקישור האישי שלך:");
        t.AppendLine(m.LinkUrl);
        t.AppendLine();
        t.AppendLine("תודה שהצטרפת ל-PORTAL X!");
        t.AppendLine();
        t.AppendLine("קיבלת את המייל הזה כי יצרת קישור אישי באתר PORTAL X.");
        t.AppendLine("יצירת קשר: " + m.ContactEmail);
        if (m.UnsubscribeUrl != null) t.AppendLine("להסרה מרשימת הדיוור: " + m.UnsubscribeUrl);
        return t.ToString();
    }
}

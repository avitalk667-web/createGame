using System.Globalization;
using static System.Net.WebUtility;
using PortalX.Server.Challenge;

namespace PortalX.Server.Treasure;

/// <summary>What the prize email says; every value comes from the stored draw.</summary>
public sealed record TreasureEmailModel(string Title, string? CouponCode, decimal? Percent, DateTime? ExpiresAtUtc, string? GiftName, string OrderUrl);

/// <summary>
/// The email that keeps a treasure prize with its winner (sent once, when the chest is opened). The same look as the other
/// coupon emails: table layout, inline styles, right-to-left Hebrew, no images, and a plain text twin. Transactional — it
/// belongs to the purchase, so it carries no marketing content.
/// </summary>
public static class TreasureEmailTemplate
{
    public const string Subject = "הפרס שלכם מתיבת האוצר של PORTAL X";

    private static string Pct(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture) + "%";

    private static string Body(TreasureEmailModel m) => m.CouponCode != null
        ? $"קוד הקופון שלכם: {m.CouponCode} — {Pct(m.Percent ?? 0)} הנחה על רכישה אחת של משחק באתר, בתוקף עד {ChallengeRules.FormatIsrael(m.ExpiresAtUtc!.Value)}. הקופון אישי: הזינו בהזמנה את כתובת הדוא״ל הזו."
        : $"קיבלתם במתנה את המשחק „{m.GiftName}”. פותחים אותו מדף ההזמנה שלכם, מתי שתרצו.";

    public static string Html(TreasureEmailModel m)
    {
        string E(string s) => HtmlEncode(s);
        return $"""
            <!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
            <body style="margin:0;background:#0a1230;font-family:Arial,'Segoe UI',Helvetica,sans-serif;color:#1b2238">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1230;padding:24px 0"><tr><td align="center">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
            <tr><td style="background:#0a1230;padding:22px 28px;border-bottom:3px solid #e0b95c;color:#f6d78d;font-size:22px;font-weight:bold;text-align:right">PORTAL X · תיבת האוצר</td></tr>
            <tr><td style="padding:28px;text-align:right;font-size:16px;line-height:1.7">
            <h1 style="margin:0 0 12px;font-size:22px;color:#0a1230">{E(m.Title)}</h1>
            {(m.CouponCode != null ? $"<p style=\"margin:0 0 16px\"><span style=\"display:inline-block;padding:10px 18px;border:2px dashed #e0b95c;border-radius:10px;font-size:22px;letter-spacing:2px;direction:ltr;font-weight:bold\">{E(m.CouponCode)}</span></p>" : "")}
            <p style="margin:0 0 20px">{E(Body(m))}</p>
            <p style="margin:0"><a href="{E(m.OrderUrl)}" style="display:inline-block;background:#e0b95c;color:#0a1230;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">לדף ההזמנה שלי</a></p>
            </td></tr></table></td></tr></table></body></html>
            """;
    }

    public static string Text(TreasureEmailModel m) => $"{m.Title}\n\n{Body(m)}\n\nדף ההזמנה שלכם: {m.OrderUrl}\n\nPORTAL X";
}

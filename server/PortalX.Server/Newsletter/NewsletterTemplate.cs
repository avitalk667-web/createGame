using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using static System.Net.WebUtility;

namespace PortalX.Server.Newsletter;

/// <summary>
/// What belongs to one recipient: their first name, their own two personal links and their own signed unsubscribe link.
/// A missing value hides its part (never a placeholder link, never someone else's link).
/// </summary>
/// <param name="CopyPageUrl">The site's page that shows this recipient's own personal link to copy (/my-link/{token}); null without an active link.</param>
/// <param name="Tracked">Link kind ("share", "cta", "home") → the tracked address of this one email; none in previews.</param>
public sealed record NewsletterRecipient(string Email, string? FirstName, string? CopyPageUrl, string? UnsubscribeUrl,
    IReadOnlyDictionary<string, string>? Tracked = null)
{
    /// <summary>Where a button points: its tracked address when the email has one, else the link itself.</summary>
    public string Href(string kind, string url) => Tracked != null && Tracked.TryGetValue(kind, out var t) ? t : url;
}

/// <summary>Where the email points: the public site and the one contact address.</summary>
public sealed record NewsletterSite(string SiteUrl, string ContactEmail, NewsletterRaffle? Raffle = null);

/// <summary>The site's raffle while it is still ahead (the same texts as the site's banner); null = no raffle line.</summary>
public sealed record NewsletterRaffle(string Prize, string When)
{
    public string Line => $"כל רכישה דרך הקישור האישי = כרטיס להגרלה על {Prize}!";
    public string WhenLine => $"ההגרלה: {When}";
}

/// <summary>
/// The fixed "סודות הפורטל" email around a <see cref="NewsletterContent"/>: header (logo, title, tagline), opening,
/// main blocks, personal links, offer, button, signature and the legal footer.
///
/// Built for Gmail: one 600px column of tables, every style inline (the small &lt;style&gt; block only narrows paddings on
/// phones), right-to-left, Arial, no script, no background images, a solid colour behind every gradient, and only two
/// pictures (the logo, and the coupon picture when one is set) — both with alt text, so the email reads fully with
/// images off. The links and offer boxes sit side by side on a computer and stack on a phone without media queries.
/// </summary>
public static partial class NewsletterTemplate
{
    private const string Font = "Arial,'Segoe UI',Helvetica,sans-serif";
    private const string Page = "#060b22";
    private const string Frame = "#0b1538";
    private const string Gold = "#e2b553";
    private const string GoldLight = "#f7dc8f";
    private const string GoldDark = "#9a6c1c";
    private const string Purple = "#4a1d86";
    private const string PurpleDeep = "#2c0d57";
    private const string Cream = "#fbf1da";
    private const string CreamCard = "#fff8e8";
    private const string Ink = "#2a1d0c";
    private const string Muted = "#9aa6c8";
    private const string Blue = "#0e3a7a";
    private const string BlueDeep = "#0a2552";
    private const string BlueGlow = "#49c0ff";
    private const string ShareBox = "#0f1d48";

    public const string Title = "סודות הפורטל";
    public const string Tagline = "חידות | אתגרים | הצצות | הטבות מיוחדות";
    public const string LogoPath = "/img/mail/portal-x-logo.png";

    /// <summary>Only narrows paddings and type on phones; the email is complete without it (clients that drop &lt;style&gt;).</summary>
    private const string Css = """
<style>
@media only screen and (max-width:620px){ .wrap{width:100% !important;} .px{padding-left:10px !important;padding-right:10px !important;} .ttl{font-size:30px !important;} .cta a{font-size:19px !important;padding:14px 22px !important;} .col{max-width:100% !important;display:block !important;margin:8px 0 !important;} }
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
</style>
""";

    public static string Subject(NewsletterContent c) => (c.AdPrefix ? "פרסומת: " : "") + c.Subject.Trim();

    /// <summary>A link of the site ("/games/x") made absolute; a full https address stays as it is.</summary>
    public static string Absolute(string url, string siteUrl) => url.StartsWith('/') ? siteUrl.TrimEnd('/') + url : url;

    private static string E(string? s) => HtmlEncode(s ?? "");
    private static string Pct(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture) + "%";

    [GeneratedRegex(@"\*\*(.+?)\*\*")] private static partial Regex Bold();

    /// <summary>Editor text → safe HTML: paragraphs on blank lines, line breaks, "•"/"-" bullets, **bold**. Never raw HTML.</summary>
    public static string Rich(string? text, string color, int size = 16, string align = "right")
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var h = new StringBuilder();
        var paragraphs = Regex.Split(text.Replace("\r\n", "\n").Trim(), @"\n\s*\n");
        foreach (var p in paragraphs)
        {
            var lines = p.Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).Select(l =>
            {
                var bullet = l.StartsWith("• ") || l.StartsWith("- ");
                var body = Bold().Replace(E(bullet ? l[2..] : l), "<b>$1</b>");
                return bullet ? $"<span style=\"color:{GoldDark};\">✦</span>&nbsp;{body}" : body;
            });
            h.Append($"<p style=\"margin:0 0 10px;font-family:{Font};font-size:{size}px;line-height:1.65;color:{color};text-align:{align};\">{string.Join("<br>", lines)}</p>");
        }
        return h.ToString();
    }

    private static string Ribbon(string text, int size = 24) => $"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 14px;"><tr><td align="center" bgcolor="{Purple}" style="background-color:{Purple};background-image:linear-gradient(180deg,#6a2fb8,{PurpleDeep});border:2px solid {Gold};border-radius:999px;padding:8px 26px;font-family:{Font};font-size:{size}px;font-weight:bold;line-height:1.3;color:{GoldLight};">{text}</td></tr></table>
""";

    private static string Card(string inner, string pad = "18px 18px 12px") => $"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td bgcolor="{Cream}" style="background-color:{Cream};background-image:linear-gradient(180deg,#fff7e4,#f4e3bd);border:2px solid {Gold};border-radius:16px;padding:{pad};text-align:right;" dir="rtl">{inner}</td></tr></table>
""";

    private static string Row(string inner, string pad = "10px 16px") => $"<tr><td class=\"px\" style=\"padding:{pad};\" dir=\"rtl\">{inner}</td></tr>\n";

    /// <summary>The raffle strip inside the share box: a gold-edged note, no countdown (an email cannot tick).</summary>
    private static string RaffleHtml(NewsletterContent c, NewsletterSite site)
    {
        if (!c.Links.ShowRaffle || site.Raffle is not { } d) return "";
        var line = E(d.Line).Replace(E(d.Prize), $"<span style=\"color:{GoldLight};white-space:nowrap;\">{E(d.Prize)}</span>");
        return $"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;"><tr><td align="center" bgcolor="#1a2a66" style="background-color:#1a2a66;border:1px solid {Gold};border-radius:12px;padding:9px 10px;text-align:center;" dir="rtl">
<p style="margin:0;font-family:{Font};font-size:15px;font-weight:bold;line-height:1.45;color:#ffffff;text-align:center;">🎁 {line}</p>
<p style="margin:3px 0 0;font-family:{Font};font-size:13px;line-height:1.45;color:#dce8ff;text-align:center;">{E(d.WhenLine)}</p>
</td></tr></table>
""";
    }

    public static string Html(NewsletterContent c, NewsletterRecipient r, NewsletterSite site)
    {
        var siteUrl = site.SiteUrl.TrimEnd('/');
        var h = new StringBuilder();
        h.Append($"""
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>{E(Subject(c))}</title>
{Css}
</head>
<body style="margin:0;padding:0;background-color:{Page};" dir="rtl">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:{Page};opacity:0;">{E(c.Preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{Page}" style="width:100%;background-color:{Page};">
<tr><td align="center" style="padding:18px 6px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="{Frame}" style="width:600px;max-width:600px;background-color:{Frame};border:2px solid {Gold};border-radius:20px;" dir="rtl">

""");
        // A — the fixed header
        h.Append($"""
<tr><td align="center" bgcolor="#11214f" style="padding:22px 16px 8px;background-color:#11214f;background-image:linear-gradient(180deg,#152a63,{Frame});border-radius:18px 18px 0 0;">
<img src="{E(siteUrl + LogoPath)}" width="200" height="156" alt="PORTAL-X" style="display:block;margin:0 auto;width:200px;max-width:62%;height:auto;border:0;outline:none;text-decoration:none;font-family:{Font};font-size:30px;font-weight:bold;letter-spacing:3px;color:{GoldLight};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 0;"><tr><td align="center" bgcolor="#e9c46a" class="ttl" style="background-color:#e9c46a;background-image:linear-gradient(180deg,#fde7a6,#d6a23e);border:2px solid {GoldDark};border-radius:14px;padding:8px 26px;font-family:{Font};font-size:36px;font-weight:bold;line-height:1.25;color:#2a1606;">🔐 {Title}</td></tr></table>
<p style="margin:12px 0 4px;font-family:{Font};font-size:16px;font-weight:bold;color:#ffffff;">חידות <span style="color:{Gold};">✦</span> אתגרים <span style="color:{Gold};">✦</span> הצצות <span style="color:{Gold};">✦</span> הטבות מיוחדות</p>
</td></tr>

""");

        // B — the opening
        if (c.Intro.Show)
        {
            var inner = new StringBuilder(Ribbon(E(c.Intro.Title), 26));
            if (c.Greeting && !string.IsNullOrWhiteSpace(r.FirstName))
                inner.Append($"<p style=\"margin:0 0 6px;font-family:{Font};font-size:18px;font-weight:bold;color:{PurpleDeep};text-align:center;\">שלום {E(r.FirstName!.Trim())},</p>");
            if (!string.IsNullOrWhiteSpace(c.Intro.Lead))
                inner.Append($"<p style=\"margin:0 0 8px;font-family:{Font};font-size:21px;font-weight:bold;line-height:1.4;color:#1d1240;text-align:center;\">{E(c.Intro.Lead)}</p>");
            inner.Append(Rich(c.Intro.Text, Ink, 16, "center"));
            inner.Append($"<p style=\"margin:4px 0 0;font-family:{Font};font-size:14px;letter-spacing:4px;color:{GoldDark};text-align:center;\">───── ✦ ─────</p>");
            h.Append(Row(Card(inner.ToString()), "14px 16px 8px"));
        }

        // C — the main blocks
        foreach (var s in c.Sections.Where(s => s.Show))
        {
            var icon = string.IsNullOrWhiteSpace(s.Icon) ? "" : E(s.Icon.Trim()) + "&nbsp; ";
            var inner = new StringBuilder(Ribbon(icon + E(s.Title), 23));
            inner.Append(Rich(s.Text, Ink, 16));
            if (s.Kind == "riddle")
            {
                foreach (var clue in s.Clues)
                    inner.Append($"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 7px;"><tr>
<td width="78" align="center" bgcolor="{Purple}" style="width:78px;background-color:{Purple};background-image:linear-gradient(180deg,#6a2fb8,{PurpleDeep});border:1px solid {Gold};border-radius:0 12px 12px 0;padding:8px 4px;font-family:{Font};font-size:22px;font-weight:bold;letter-spacing:2px;color:#ffffff;" dir="ltr">{E(clue.Code)}</td>
<td bgcolor="#fffdf6" style="background-color:#fffdf6;border:1px solid #d9b765;border-right:0;border-radius:12px 0 0 12px;padding:8px 12px;font-family:{Font};font-size:15px;line-height:1.45;color:{Ink};text-align:right;" dir="rtl">{E(clue.Text)}</td>
</tr></table>
""");
                if (!string.IsNullOrWhiteSpace(s.Question))
                    inner.Append($"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:10px 0 8px;"><tr><td align="center" bgcolor="{Purple}" style="background-color:{Purple};background-image:linear-gradient(180deg,#6a2fb8,{PurpleDeep});border:2px solid {Gold};border-radius:999px;padding:10px 16px;font-family:{Font};font-size:21px;font-weight:bold;line-height:1.35;color:{GoldLight};">❓ {E(s.Question)}</td></tr></table>
""");
                if (!string.IsNullOrWhiteSpace(s.ReplyNote))
                    inner.Append($"<p style=\"margin:4px 0 4px;font-family:{Font};font-size:15px;font-weight:bold;color:{Ink};text-align:center;\">✉️ {E(s.ReplyNote)}</p>");
            }
            h.Append(Row(Card(inner.ToString()), "8px 16px"));
        }

        // D + E — the share area and the offer: side by side on a computer, stacked on a phone (share first)
        var copyPage = c.Links.Show ? r.CopyPageUrl : null;
        var showLinks = copyPage != null;
        if (showLinks || c.Offer.Show)
        {
            var both = showLinks && c.Offer.Show;
            var box = both ? "max-width:272px;" : "max-width:564px;";
            h.Append($"<tr><td class=\"px\" align=\"center\" style=\"padding:8px 12px;font-size:0;text-align:center;\" dir=\"ltr\">\n");
            if (showLinks)
            {
                // one button to a page of the site that shows the recipient's own link and copies it (an email cannot copy)
                h.Append($"""
<div class="col" style="display:inline-block;width:100%;{box}vertical-align:top;margin:6px 4px;" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center" bgcolor="{ShareBox}" style="background-color:{ShareBox};background-image:linear-gradient(180deg,#13265c,{ShareBox});border:1px solid #2b4c95;border-radius:16px;padding:16px 14px 14px;text-align:center;" dir="rtl">
<p style="margin:0 0 6px;font-family:{Font};font-size:20px;font-weight:bold;line-height:1.35;color:#ffffff;text-align:center;">🔗 {E(c.Links.Title)}</p>
{(string.IsNullOrWhiteSpace(c.Links.Note) ? "" : $"<p style=\"margin:0 0 12px;font-family:{Font};font-size:15px;line-height:1.5;color:#dce8ff;text-align:center;\">{E(c.Links.Note)}</p>")}
{RaffleHtml(c, site)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center" bgcolor="#dff3ff" style="background-color:#dff3ff;background-image:linear-gradient(180deg,#eef9ff,#cdeafe);border:1px solid #9fd6ff;border-radius:999px;">
<a href="{E(r.Href("share", copyPage!))}" style="display:block;padding:13px 14px;font-family:{Font};font-size:16px;font-weight:bold;line-height:1.3;color:{BlueDeep};text-decoration:none;border-radius:999px;">{E(c.Links.ButtonLabel)}</a>
</td></tr></table>
{(string.IsNullOrWhiteSpace(c.Links.Footnote) ? "" : $"<p style=\"margin:10px 0 0;font-family:{Font};font-size:13px;line-height:1.5;color:#b9cbef;text-align:center;\">{E(c.Links.Footnote)}</p>")}
</td></tr></table>
</div>

""");
            }
            if (c.Offer.Show)
            {
                var o = c.Offer;
                var image = string.IsNullOrWhiteSpace(o.ImageUrl) ? "" :
                    $"<img src=\"{E(o.ImageUrl)}\" width=\"240\" alt=\"קופון {E(o.Code)}: {E(Pct(o.Percent))} הנחה\" style=\"display:block;margin:0 auto 10px;width:100%;max-width:240px;height:auto;border:0;border-radius:10px;font-family:{Font};font-size:14px;color:{GoldLight};\">";
                h.Append($"""
<div class="col" style="display:inline-block;width:100%;{box}vertical-align:top;margin:6px 4px;" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td bgcolor="#3b1470" style="background-color:#3b1470;background-image:linear-gradient(180deg,#4f1d93,#250a4a);border:2px solid {Gold};border-radius:16px;padding:14px;text-align:center;" dir="rtl">
<p style="margin:0;font-family:{Font};font-size:20px;font-weight:bold;line-height:1.3;color:{GoldLight};">🎁 {E(o.Title)}</p>
{(string.IsNullOrWhiteSpace(o.Subtitle) ? "" : $"<p style=\"margin:2px 0 10px;font-family:{Font};font-size:15px;font-weight:bold;color:#ffffff;\">{E(o.Subtitle)}</p>")}
{image}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 10px;"><tr><td align="center" bgcolor="#ffe9a8" style="background-color:#ffe9a8;background-image:linear-gradient(180deg,#fff4cf,#f6cf6a);border:2px dashed {GoldDark};border-radius:14px;padding:10px 8px;">
<p style="margin:0;font-family:{Font};font-size:34px;font-weight:bold;line-height:1.15;color:#3b1470;"><span dir="ltr">{E(Pct(o.Percent))}</span> הנחה</p>
<p style="margin:4px 0 0;font-family:{Font};font-size:15px;font-weight:bold;line-height:1.4;color:{Ink};">ברכישת המשחק "{E(o.GameName)}"</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td align="center" bgcolor="#fff7dc" style="background-color:#fff7dc;border:2px dashed {Gold};border-radius:12px;padding:9px 8px;font-family:{Font};font-size:15px;font-weight:bold;color:{Ink};">
קוד קופון: <span dir="ltr" style="font-family:{Font};font-size:26px;font-weight:bold;letter-spacing:2px;color:#3b1470;">{E(o.Code)}</span>
</td></tr></table>
{(string.IsNullOrWhiteSpace(o.Note) ? "" : $"<p style=\"margin:8px 0 0;font-family:{Font};font-size:12px;line-height:1.5;color:#e6dcff;\">{E(o.Note)}</p>")}
</td></tr></table>
</div>
""");
            }
            h.Append("</td></tr>\n");
        }

        // F — the main button
        if (c.Cta.Show)
            h.Append($"""
<tr><td align="center" style="padding:16px 16px 6px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td class="cta" align="center" bgcolor="#5b23a8" style="background-color:#5b23a8;background-image:linear-gradient(180deg,#7d3fd4,#45157f);border:3px solid {Gold};border-radius:999px;box-shadow:0 0 18px rgba(167,110,255,.55);">
<a href="{E(r.Href("cta", Absolute(c.Cta.Url, siteUrl)))}" style="display:inline-block;padding:15px 38px;font-family:{Font};font-size:23px;font-weight:bold;line-height:1.3;color:#ffffff;text-decoration:none;border-radius:999px;"><span style="color:{GoldLight};">▶</span>&nbsp; {E(c.Cta.Label)}</a>
</td></tr></table>
</td></tr>

""");

        // G — the fixed signature
        h.Append($"""
<tr><td align="center" style="padding:16px 16px 22px;font-family:{Font};">
<p style="margin:0 0 6px;font-size:23px;font-weight:bold;line-height:1.35;color:#ffffff;">מחכים לכם מעבר לפורטל!</p>
<p style="margin:0 0 4px;font-size:20px;font-weight:bold;letter-spacing:4px;color:{GoldLight};" dir="ltr">PORTAL-X</p>
<p style="margin:0;font-size:16px;font-weight:bold;color:#ffffff;"><span style="color:{Gold};">───</span>&nbsp; צוות PORTAL-X &nbsp;<span style="color:{Gold};">───</span></p>
</td></tr>
</table>

""");

        // the footer: why this arrived, the sender, how to reach us and the personal unsubscribe link
        var host = siteUrl.Replace("https://", "").Replace("http://", "");
        var unsub = r.UnsubscribeUrl != null
            ? $"<a href=\"{E(r.UnsubscribeUrl)}\" style=\"color:{GoldLight};text-decoration:underline;\">להסרה מרשימת הדיוור לחצו כאן</a>"
            : $"<span style=\"color:{GoldLight};\">[במייל לנמען יופיע כאן קישור ההסרה האישי שלו]</span>";
        h.Append($"""
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;"><tr><td class="px" style="padding:14px 18px 4px;font-family:{Font};font-size:12px;line-height:1.75;color:{Muted};text-align:center;" dir="rtl">
קיבלתם את המייל הזה כי הסכמתם לקבל דיוור מ־PORTAL-X (סודות הפורטל). {unsub} · אפשר גם להשיב למייל זה עם המילה "הסר".<br>
השולח: צוות PORTAL-X · חדרי בריחה וירטואליים · <a href="{E(r.Href("home", siteUrl))}" style="color:{GoldLight};">{E(host)}</a> · לפניות: <a href="mailto:{E(site.ContactEmail)}" style="color:{GoldLight};">{E(site.ContactEmail)}</a>
</td></tr></table>
</td></tr>
</table>
</body>
</html>
""");
        return h.ToString();
    }

    /// <summary>The plain-text twin (shown by clients that do not show HTML, and read by spam filters).</summary>
    public static string Text(NewsletterContent c, NewsletterRecipient r, NewsletterSite site)
    {
        var siteUrl = site.SiteUrl.TrimEnd('/');
        static string Plain(string? s) => Bold().Replace((s ?? "").Replace("\r\n", "\n").Trim(), "$1");
        var t = new StringBuilder();
        t.AppendLine($"🔐 {Title} — PORTAL-X");
        t.AppendLine(Tagline);
        t.AppendLine();
        if (c.Intro.Show)
        {
            t.AppendLine(c.Intro.Title);
            if (c.Greeting && !string.IsNullOrWhiteSpace(r.FirstName)) t.AppendLine($"שלום {r.FirstName!.Trim()},");
            if (!string.IsNullOrWhiteSpace(c.Intro.Lead)) t.AppendLine(c.Intro.Lead);
            if (!string.IsNullOrWhiteSpace(c.Intro.Text)) t.AppendLine(Plain(c.Intro.Text));
            t.AppendLine();
        }
        foreach (var s in c.Sections.Where(s => s.Show))
        {
            t.AppendLine($"== {s.Title} ==");
            if (!string.IsNullOrWhiteSpace(s.Text)) t.AppendLine(Plain(s.Text));
            if (s.Kind == "riddle")
            {
                foreach (var clue in s.Clues) t.AppendLine($"{clue.Code} — {clue.Text}");
                if (!string.IsNullOrWhiteSpace(s.Question)) t.AppendLine(s.Question);
                if (!string.IsNullOrWhiteSpace(s.ReplyNote)) t.AppendLine(s.ReplyNote);
            }
            t.AppendLine();
        }
        if (c.Links.Show && r.CopyPageUrl != null)
        {
            t.AppendLine($"== {c.Links.Title} ==");
            if (!string.IsNullOrWhiteSpace(c.Links.Note)) t.AppendLine(c.Links.Note);
            if (c.Links.ShowRaffle && site.Raffle is { } d) { t.AppendLine("🎁 " + d.Line); t.AppendLine(d.WhenLine); }
            t.AppendLine($"{c.Links.ButtonLabel}: {r.Href("share", r.CopyPageUrl)}");
            if (!string.IsNullOrWhiteSpace(c.Links.Footnote)) t.AppendLine(c.Links.Footnote);
            t.AppendLine();
        }
        if (c.Offer.Show)
        {
            t.AppendLine($"== {c.Offer.Title} {c.Offer.Subtitle} ==".Replace("  ", " "));
            t.AppendLine($"{Pct(c.Offer.Percent)} הנחה ברכישת המשחק \"{c.Offer.GameName}\"");
            t.AppendLine($"קוד קופון: {c.Offer.Code}");
            if (!string.IsNullOrWhiteSpace(c.Offer.Note)) t.AppendLine(c.Offer.Note);
            t.AppendLine();
        }
        if (c.Cta.Show) t.AppendLine($"{c.Cta.Label}: {r.Href("cta", Absolute(c.Cta.Url, siteUrl))}").AppendLine();
        t.AppendLine("מחכים לכם מעבר לפורטל!");
        t.AppendLine("צוות PORTAL-X");
        t.AppendLine();
        t.AppendLine("קיבלתם את המייל הזה כי הסכמתם לקבל דיוור מ־PORTAL-X (סודות הפורטל).");
        if (r.UnsubscribeUrl != null) t.AppendLine("להסרה מרשימת הדיוור: " + r.UnsubscribeUrl);
        t.AppendLine($"PORTAL-X · חדרי בריחה וירטואליים · {siteUrl} · לפניות: {site.ContactEmail}");
        return t.ToString();
    }
}

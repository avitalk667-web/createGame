using System.Text;
using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using static System.Net.WebUtility;

namespace PortalX.Server.Referrals;

/// <summary>
/// The "friend brings a friend" campaign: its texts and draw date live in Content/campaign.he.json, so they can be changed
/// without touching code. It only shows a message and counts qualifying buyers for the admin — it pays nothing.
/// </summary>
public sealed class CampaignContent
{
    public bool Enabled { get; init; }
    public string Title { get; init; } = "";
    public string Prize { get; init; } = "";
    public string Lead { get; init; } = "";
    public string Body { get; init; } = "";
    public string DrawLabel { get; init; } = "";
    public string DrawDate { get; init; } = "";
    public string ButtonLabel { get; init; } = "";
    public string PopupTitle { get; init; } = "";
    public string PopupBody { get; init; } = "";
    public string PopupCreateLabel { get; init; } = "";
    public string PopupLaterLabel { get; init; } = "";
    /// <summary>Different paying buyers through one personal link needed to enter the draw.</summary>
    public int MinBuyers { get; init; } = 4;

    public static CampaignContent LoadDefault()
    {
        var file = Path.Combine(AppContext.BaseDirectory, "Content", "campaign.he.json");
        return File.Exists(file)
            ? JsonSerializer.Deserialize<CampaignContent>(File.ReadAllText(file), ScenarioCatalog.JsonOptions) ?? new CampaignContent()
            : new CampaignContent();
    }

    /// <summary>
    /// Different buyers of a link who count for the draw: a real, verified payment that is still paid (not refunded,
    /// cancelled or failed), not a test payment and not the owner's own purchase — the same rules as the link's numbers.
    /// A buyer is known by the order's email; an order without one counts on its own.
    /// </summary>
    public static int QualifyingBuyers(IEnumerable<Order> linkOrders) =>
        linkOrders.Where(o => ReferralAdmin.Counts(o) && o.Status == OrderStatus.Paid)
            .Select(o => ResultsEmailService.NormalizeEmail(o.Email) ?? "order:" + o.Id).Distinct().Count();

    /// <summary>
    /// The banner inside an email: a table with inline styles (no script, no background image, works with images off),
    /// at most 600px wide, right-to-left. The button leads to the personal-link page of the site.
    /// </summary>
    public string EmailHtml(string siteUrl)
    {
        string E(string s) => HtmlEncode(s);
        const string font = "Arial,'Segoe UI',Helvetica,sans-serif";
        var url = siteUrl.TrimEnd('/') + "/share";
        var title = E(Title).Replace(E(Prize), $"<span style=\"color:#f6d78d;white-space:nowrap;\">{E(Prize)}</span>");
        return $"""
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;max-width:600px;">
<tr><td align="center" style="background:#0a1230;border:2px solid #e0b95c;border-radius:16px;padding:22px 18px;font-family:{font};color:#ffffff;text-align:center;" dir="rtl">
  <div style="font-size:13px;letter-spacing:3px;color:#e0b95c;font-weight:bold;" dir="ltr">&#9673; PORTAL X &#9673;</div>
  <div style="margin:8px 0 6px;font-size:22px;line-height:1.35;font-weight:bold;color:#ffffff;">{title}</div>
  <div style="margin:4px 0 10px;font-size:46px;line-height:1.1;font-weight:bold;color:#f6d78d;" dir="rtl">{E(Prize)}</div>
  <div style="margin:0 0 4px;font-size:16px;line-height:1.6;font-weight:bold;color:#f6d78d;">{E(Lead)}</div>
  <div style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#e8ecfb;">{E(Body)}</div>
  <div style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#c9d2ee;">{E(DrawLabel)}: <b style="color:#ffffff;">{E(DrawDate)}</b></div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="border-radius:999px;background:#e0b95c;">
    <a href="{E(url)}" style="display:inline-block;padding:12px 28px;font-family:{font};font-size:16px;font-weight:bold;color:#2a1606;text-decoration:none;border-radius:999px;">{E(ButtonLabel)}</a>
  </td></tr></table>
</td></tr>
</table>
""";
    }

    /// <summary>The same message in the plain text twin of the email.</summary>
    public string EmailText(string siteUrl)
    {
        var t = new StringBuilder();
        t.AppendLine("— " + Title + " —");
        t.AppendLine(Lead);
        t.AppendLine(Body);
        t.AppendLine($"{DrawLabel}: {DrawDate}");
        t.AppendLine($"{ButtonLabel}: {siteUrl.TrimEnd('/')}/share");
        return t.ToString();
    }

    /// <summary>What the site shows (banner and popup).</summary>
    public object Public() => new
    {
        enabled = Enabled, title = Title, prize = Prize, lead = Lead, body = Body, drawLabel = DrawLabel, drawDate = DrawDate,
        buttonLabel = ButtonLabel, popupTitle = PopupTitle, popupBody = PopupBody, popupCreateLabel = PopupCreateLabel,
        popupLaterLabel = PopupLaterLabel, minBuyers = MinBuyers,
    };
}

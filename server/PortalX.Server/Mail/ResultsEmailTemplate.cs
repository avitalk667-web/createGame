using System.Globalization;
using System.Text;
using static System.Net.WebUtility;

namespace PortalX.Server.Mail;

public sealed record TeamScore(string Nickname, int Points, int Rank, bool IsRecipient);
public sealed record EarnedAchievement(string Title, string Description);

/// <summary>Only data the game really stored; anything missing is left out of the email (spec 6).</summary>
public sealed record ResultsEmailModel(
    string GameName, DateTime? PlayedAtUtc, string RecipientNickname,
    int? PersonalPoints, int? PersonalRank, bool Tie, IReadOnlyList<TeamScore> Team, int? GroupPoints,
    int? DurationSeconds, int? PuzzlesSolved, int? PuzzlesTotal, int PlayersCount, IReadOnlyList<EarnedAchievement> Achievements,
    string SiteUrl, string ContactEmail, string? UnsubscribeUrl);

/// <summary>
/// The results email: table layout and inline styles so it looks right in common mail programs, right-to-left Hebrew,
/// readable with images blocked (it uses none), and a plain text twin. Every value from players is HTML-encoded.
/// </summary>
public static class ResultsEmailTemplate
{
    private const string Navy = "#0a1230";
    private const string Navy2 = "#14204a";
    private const string Gold = "#e0b95c";
    private const string GoldLight = "#f6d78d";
    private const string Ink = "#1b2238";
    private const string Paper = "#ffffff";
    private const string Soft = "#eef3ff";
    private const string Font = "Arial,'Segoe UI',Helvetica,sans-serif";
    /// <summary>Phones: the score cards stack and the margins shrink (clients that ignore it still get a readable table).</summary>
    private const string MobileCss = "<style>@media only screen and (max-width: 620px) { .container { width:100% !important; } .px { padding-left:16px !important; padding-right:16px !important; } .card { display:block !important; width:100% !important; padding:0 0 10px 0 !important; } }</style>";

    /// <summary>The game's name as shown, with stray spaces collapsed.</summary>
    private static string Name(ResultsEmailModel m) => string.Join(' ', m.GameName.Split(' ', StringSplitOptions.RemoveEmptyEntries));

    public static string Subject(ResultsEmailModel m) =>
        Name(m).Contains("PORTAL X") ? $"התוצאות שלכם: {Name(m)}" : $"התוצאות שלכם: {Name(m)} — PORTAL X";

    public static string Date(DateTime? utc)
    {
        if (utc == null) return "";
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
        catch (Exception) { zone = TimeZoneInfo.CreateCustomTimeZone("IL", TimeSpan.FromHours(2), "IL", "IL"); }
        return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc.Value, DateTimeKind.Utc), zone).ToString("dd.MM.yyyy · HH:mm", CultureInfo.InvariantCulture);
    }

    public static string Duration(int seconds) =>
        seconds >= 3600 ? $"{seconds / 3600}:{seconds / 60 % 60:00}:{seconds % 60:00}" : $"{seconds / 60:00}:{seconds % 60:00}";

    private static string Summary(ResultsEmailModel m)
    {
        if (m.PersonalRank == 1 && m.Team.Count > 1) return m.Tie ? "סיימתם בתיקו במקום הראשון — עבודת צוות מנצחת!" : "סיימתם במקום הראשון — כל הכבוד!";
        if (m.PuzzlesSolved != null && m.PuzzlesSolved == m.PuzzlesTotal) return "פתרתם את כל החידות והגעתם עד הסוף. איזו הרפתקה!";
        return "השלמתם את ההרפתקה. מחכים לכם עוד הרבה חידות ועולמות לגלות.";
    }

    public static string Html(ResultsEmailModel m)
    {
        var h = new StringBuilder();
        string E(string s) => HtmlEncode(s);
        h.Append($"""
<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>{E(Subject(m))}</title>
{MobileCss}
</head>
<body style="margin:0;padding:0;background:{Navy};" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{Navy};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:8px 0 18px;font-family:{Font};font-size:30px;font-weight:bold;letter-spacing:4px;color:{GoldLight};" dir="ltr">PORTAL X</td></tr>
<tr><td class="px" style="background:{Paper};border-radius:16px;border-top:4px solid {Gold};padding:28px 32px;font-family:{Font};color:{Ink};text-align:right;" dir="rtl">
  <h1 style="margin:0 0 6px;font-size:26px;line-height:1.3;color:{Navy};">כל הכבוד! השלמתם את ההרפתקה</h1>
  <p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#7a5a12;">{E(Name(m))}</p>
""");
        if (m.PlayedAtUtc != null) h.Append($"""  <p style="margin:0 0 18px;font-size:14px;color:#5b6480;">שוחק ב־<span dir="ltr">{E(Date(m.PlayedAtUtc))}</span> · {E(m.RecipientNickname)}</p>""");
        else h.Append($"""  <p style="margin:0 0 18px;font-size:14px;color:#5b6480;">{E(m.RecipientNickname)}</p>""");

        // the recipient's own points — the main card — and the group's points beside it
        if (m.PersonalPoints != null || m.GroupPoints != null)
        {
            h.Append("""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>""");
            if (m.PersonalPoints != null)
                h.Append($"""<td class="card" width="58%" valign="top" style="padding:0 0 10px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{Navy};border-radius:14px;border:2px solid {Gold};"><tr><td align="center" style="padding:18px 10px;font-family:{Font};"><div style="font-size:14px;color:{GoldLight};">הניקוד האישי שלך</div><div style="font-size:44px;line-height:1.1;font-weight:bold;color:#ffffff;">{m.PersonalPoints}</div>{(m.PersonalRank != null && m.Team.Count > 1 ? $"<div style=\"font-size:14px;color:{GoldLight};\">מקום {m.PersonalRank} מתוך {m.Team.Count}{(m.Tie && m.PersonalRank == 1 ? " (תיקו)" : "")}</div>" : "")}</td></tr></table></td>""");
            if (m.GroupPoints != null)
                h.Append($"""<td class="card" valign="top" style="padding:0 0 10px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{Soft};border-radius:14px;border:1px solid #c9d6f5;"><tr><td align="center" style="padding:18px 10px;font-family:{Font};"><div style="font-size:14px;color:#3a4a78;">הניקוד הקבוצתי</div><div style="font-size:36px;line-height:1.15;font-weight:bold;color:{Navy};">{m.GroupPoints}</div><div style="font-size:13px;color:#3a4a78;">{m.PlayersCount} {(m.PlayersCount == 1 ? "משתתף" : "משתתפים")}</div></td></tr></table></td>""");
            h.Append("</tr></table>");
        }

        // time and puzzles
        var facts = new List<(string Label, string Value, string Dir)>();
        if (m.DurationSeconds != null) facts.Add(("זמן המשחק", Duration(m.DurationSeconds.Value), "ltr"));
        if (m.PuzzlesSolved != null && m.PuzzlesTotal is > 0) facts.Add(("חידות שנפתרו", $"{m.PuzzlesSolved} מתוך {m.PuzzlesTotal}", "rtl"));
        if (m.PersonalPoints == null && m.GroupPoints == null) facts.Add(("משתתפים", m.PlayersCount.ToString(CultureInfo.InvariantCulture), "rtl"));
        if (facts.Count > 0)
        {
            h.Append($"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid #e3e7f2;border-radius:12px;">""");
            foreach (var (label, value, dir) in facts)
                h.Append($"""<tr><td style="padding:10px 14px;font-family:{Font};font-size:15px;color:#5b6480;border-bottom:1px solid #eef1f8;">{E(label)}</td><td align="left" style="padding:10px 14px;font-family:{Font};font-size:17px;font-weight:bold;color:{Navy};border-bottom:1px solid #eef1f8;" dir="{dir}">{E(value)}</td></tr>""");
            h.Append("</table>");
        }

        // the team's points: nicknames only, never anyone's address
        if (m.Team.Count > 1)
        {
            h.Append($"""<p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:{Navy};">הניקוד של הצוות</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">""");
            foreach (var p in m.Team)
            {
                var bg = p.IsRecipient ? "#fff6dc" : "#f7f8fc";
                h.Append($"""<tr><td style="padding:8px 12px;background:{bg};font-family:{Font};font-size:15px;color:{Ink};border-bottom:2px solid #ffffff;">{(p.Rank == 1 ? "🏆 " : $"{p.Rank}. ")}{E(p.Nickname)}{(p.IsRecipient ? " (את/ה)" : "")}</td><td align="left" style="padding:8px 12px;background:{bg};font-family:{Font};font-size:15px;font-weight:bold;color:{Navy};border-bottom:2px solid #ffffff;">{p.Points}</td></tr>""");
            }
            h.Append("</table>");
        }

        if (m.Achievements.Count > 0)
        {
            h.Append($"""<p style="margin:0 0 6px;font-size:15px;font-weight:bold;color:{Navy};">הישגים במשחק</p>""");
            foreach (var a in m.Achievements)
                h.Append($"""<p style="margin:0 0 6px;padding:8px 12px;background:#fff6dc;border-right:4px solid {Gold};border-radius:8px;font-size:14px;color:{Ink};"><b>★ {E(a.Title)}</b> — {E(a.Description)}</p>""");
        }

        h.Append($"""
  <p style="margin:16px 0 20px;font-size:16px;line-height:1.6;color:{Ink};">{E(Summary(m))}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" style="border-radius:999px;background:{Gold};">
    <a href="{E(m.SiteUrl)}/#games" style="display:inline-block;padding:14px 32px;font-family:{Font};font-size:17px;font-weight:bold;color:#2a1606;text-decoration:none;border-radius:999px;">לגלות עוד משחקים ב־PORTAL X</a>
  </td></tr></table>
</td></tr>
<tr><td align="center" style="padding:20px 12px 6px;font-family:{Font};font-size:13px;line-height:1.7;color:#c9d2ee;" dir="rtl">
  קיבלת את המייל הזה כי ביקשת לקבל את תוצאות המשחק.<br>
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

    public static string Text(ResultsEmailModel m)
    {
        var t = new StringBuilder();
        t.AppendLine("PORTAL X");
        t.AppendLine("כל הכבוד! השלמתם את ההרפתקה");
        t.AppendLine(Name(m));
        if (m.PlayedAtUtc != null) t.AppendLine("שוחק ב־" + Date(m.PlayedAtUtc));
        t.AppendLine();
        if (m.PersonalPoints != null) t.AppendLine($"הניקוד האישי שלך: {m.PersonalPoints}" + (m.PersonalRank != null && m.Team.Count > 1 ? $" (מקום {m.PersonalRank} מתוך {m.Team.Count})" : ""));
        if (m.GroupPoints != null) t.AppendLine($"הניקוד הקבוצתי: {m.GroupPoints}");
        if (m.DurationSeconds != null) t.AppendLine("זמן המשחק: " + Duration(m.DurationSeconds.Value));
        if (m.PuzzlesSolved != null && m.PuzzlesTotal is > 0) t.AppendLine($"חידות שנפתרו: {m.PuzzlesSolved} מתוך {m.PuzzlesTotal}");
        if (m.Team.Count > 1)
        {
            t.AppendLine();
            t.AppendLine("הניקוד של הצוות:");
            foreach (var p in m.Team) t.AppendLine($"{p.Rank}. {p.Nickname}{(p.IsRecipient ? " (את/ה)" : "")} — {p.Points}");
        }
        if (m.Achievements.Count > 0)
        {
            t.AppendLine();
            t.AppendLine("הישגים במשחק:");
            foreach (var a in m.Achievements) t.AppendLine($"★ {a.Title} — {a.Description}");
        }
        t.AppendLine();
        t.AppendLine(Summary(m));
        t.AppendLine("לגלות עוד משחקים: " + m.SiteUrl);
        t.AppendLine();
        t.AppendLine("קיבלת את המייל הזה כי ביקשת לקבל את תוצאות המשחק.");
        t.AppendLine("יצירת קשר: " + m.ContactEmail);
        if (m.UnsubscribeUrl != null) t.AppendLine("להסרה מרשימת הדיוור: " + m.UnsubscribeUrl);
        return t.ToString();
    }
}

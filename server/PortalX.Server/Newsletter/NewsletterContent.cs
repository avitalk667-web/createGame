using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace PortalX.Server.Newsletter;

/// <summary>
/// What changes from one "סודות הפורטל" mailing to the next. The fixed parts (logo, title, signature, footer) live in
/// <see cref="NewsletterTemplate"/>; everything here is plain text (no HTML is ever taken from the editor), so a mailing
/// is written in the admin area, never by editing markup. Every block can be hidden on its own.
/// </summary>
public sealed partial class NewsletterContent
{
    public string Subject { get; set; } = "";
    /// <summary>Puts "פרסומת:" before the subject, as the Israeli anti-spam law asks of an advertisement (on by default).</summary>
    public bool AdPrefix { get; set; } = true;
    /// <summary>The short line inbox lists show next to the subject (hidden in the email itself).</summary>
    public string Preheader { get; set; } = "";
    /// <summary>"שלום {first name}," above the opening, when the address has a known first name.</summary>
    public bool Greeting { get; set; } = true;
    public NewsletterIntro Intro { get; set; } = new();
    public List<NewsletterSection> Sections { get; set; } = [];
    public NewsletterLinks Links { get; set; } = new();
    public NewsletterOffer Offer { get; set; } = new();
    public NewsletterCta Cta { get; set; } = new();

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public string ToJson() => JsonSerializer.Serialize(this, Json);
    public static NewsletterContent FromJson(string json)
    {
        var c = JsonSerializer.Deserialize<NewsletterContent>(json, Json) ?? new();
        // a draft saved with the earlier two-button area keeps its custom texts, but the old default wording follows the new one
        if (c.Links.Title == NewsletterLinks.OldTitle) c.Links.Title = new NewsletterLinks().Title;
        if (c.Links.Note == NewsletterLinks.OldNote) c.Links.Note = new NewsletterLinks().Note;
        return c;
    }

    public const int MaxSections = 8;
    public const int MaxClues = 10;
    public static readonly string[] Kinds = ["text", "riddle"];

    /// <summary>The first problem in the content, in Hebrew for the admin, or null when it can be saved and sent.</summary>
    public string? Validate()
    {
        static bool Long(string? s, int max) => (s ?? "").Length > max;
        if (string.IsNullOrWhiteSpace(Subject)) return "חסר נושא למייל.";
        if (Long(Subject, 150)) return "הנושא ארוך מדי (עד 150 תווים).";
        if (Long(Preheader, 200)) return "שורת התצוגה המקדימה ארוכה מדי (עד 200 תווים).";
        if (Intro.Show && string.IsNullOrWhiteSpace(Intro.Title)) return "חסרה כותרת לפתיח (או הסתירו את הפתיח).";
        if (Long(Intro.Title, 120) || Long(Intro.Text, 3000)) return "הפתיח ארוך מדי.";
        if (Sections.Count > MaxSections) return $"אפשר עד {MaxSections} אזורי תוכן במייל אחד.";
        foreach (var s in Sections)
        {
            if (!Kinds.Contains(s.Kind)) return "סוג אזור תוכן לא מוכר.";
            if (!s.Show) continue;
            if (string.IsNullOrWhiteSpace(s.Title)) return "לכל אזור תוכן מוצג צריכה להיות כותרת.";
            if (Long(s.Title, 120) || Long(s.Text, 5000) || Long(s.Icon, 8) || Long(s.Question, 200) || Long(s.ReplyNote, 200)) return $"האזור \"{s.Title}\" ארוך מדי.";
            if (s.Kind == "riddle")
            {
                if (s.Clues.Count == 0) return $"בחידה \"{s.Title}\" אין רמזים.";
                if (s.Clues.Count > MaxClues) return $"אפשר עד {MaxClues} רמזים בחידה.";
                if (s.Clues.Any(c => string.IsNullOrWhiteSpace(c.Code) || Long(c.Code, 12) || Long(c.Text, 200))) return $"בחידה \"{s.Title}\" יש רמז בלי קוד או ארוך מדי.";
            }
        }
        if (Links.Show && string.IsNullOrWhiteSpace(Links.ButtonLabel)) return "חסר טקסט לכפתור הקישור האישי (או הסתירו את האזור).";
        if (Long(Links.ButtonLabel, 60) || Long(Links.Title, 80) || Long(Links.Note, 300) || Long(Links.Footnote, 200)) return "טקסט אזור הקישור האישי ארוך מדי.";
        if (Offer.Show)
        {
            if (string.IsNullOrWhiteSpace(Offer.Code) || !CouponCode().IsMatch(Offer.Code)) return "קוד הקופון חייב להכיל אותיות באנגלית, ספרות, מקף או קו תחתון (עד 32 תווים).";
            if (Offer.Percent is <= 0 or > 100) return "אחוז ההנחה חייב להיות בין 1 ל־100.";
            if (string.IsNullOrWhiteSpace(Offer.GameName) || Long(Offer.GameName, 60)) return "חסר שם המשחק של ההטבה.";
            if (Long(Offer.Title, 80) || Long(Offer.Subtitle, 80) || Long(Offer.Note, 300)) return "טקסט ההטבה ארוך מדי.";
            if (!string.IsNullOrWhiteSpace(Offer.ImageUrl) && !IsHttps(Offer.ImageUrl)) return "תמונת הקופון חייבת להיות כתובת https מלאה.";
        }
        if (Cta.Show)
        {
            if (string.IsNullOrWhiteSpace(Cta.Label) || Long(Cta.Label, 60)) return "חסר טקסט לכפתור הפעולה (עד 60 תווים).";
            if (!IsSitePath(Cta.Url) && !IsHttps(Cta.Url)) return "כתובת הכפתור חייבת להתחיל ב־/ (דף באתר) או להיות כתובת https מלאה.";
        }
        return null;
    }

    public static bool IsHttps(string? url) =>
        !string.IsNullOrWhiteSpace(url) && url.IndexOfAny([' ', '<', '>', '"', '\'', '`', '\\']) < 0
        && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.Host.Contains('.');

    /// <summary>A page of the site: "/games/hanukkah-oil?coupon=PORTAL10" (never "//other-host").</summary>
    public static bool IsSitePath(string? url) =>
        !string.IsNullOrWhiteSpace(url) && url.StartsWith('/') && !url.StartsWith("//") && url.Length <= 300
        && url.IndexOfAny([' ', '<', '>', '"', '\'', '`', '\\']) < 0;

    [GeneratedRegex("^[a-z0-9-]{1,40}$")] public static partial Regex GameId();
    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$")] private static partial Regex CouponCode();

    /// <summary>An empty mailing with the fixed blocks switched on: the starting point of every new one.</summary>
    public static NewsletterContent Blank() => new()
    {
        Subject = "סוד חדש מחכה לכם בפורטל",
        Preheader = "",
        Intro = new() { Title = "יש לנו סוד חדש בשבילכם...", Text = "" },
        Sections = [new() { Kind = "text", Icon = "✨", Title = "כותרת האזור", Text = "" }],
        Cta = new() { Label = "לכניסה לפורטל", Url = "/" },
    };

    /// <summary>
    /// The first "סודות הפורטל" mailing. The riddle and its five clues are word for word as supplied by the owner.
    /// The customer-feedback block is a short neutral thank-you and holds no invented quotes.
    /// </summary>
    public static NewsletterContent Welcome() => new()
    {
        Subject = "ברוכים הבאים לסודות הפורטל! חידה ראשונה והטבה מיוחדת",
        Preheader = "חידת התיבה הנעולה, 10% הנחה לסוד פך השמן ועוד הפתעות מהפורטל",
        Intro = new()
        {
            Title = "ברוכים הבאים!",
            Lead = "שמחים שהצטרפתם לסודות הפורטל!",
            Text = "מכאן והלאה תיהנו מעדכונים על משחקים חדשים, חידות ואתגרים, הצצות אל מאחורי הקלעים והטבות בלעדיות לחברי הקבוצה.",
        },
        Sections =
        [
            new()
            {
                Kind = "text", Icon = "💬", Title = "התגובות הראשונות הגיעו",
                Text = "המשחקים של PORTAL-X כבר נפתחו בבתים הראשונים, ואנחנו קוראים בהתרגשות כל תגובה שמגיעה מהרוכשים.\n\nתודה לכל מי ששיחק וכתב לנו! כל מילה עוזרת לנו לבנות את החדרים הבאים טובים עוד יותר.",
            },
            new()
            {
                Kind = "riddle", Icon = "🧩", Title = "אתגר הפורטל השבועי",
                Text = "אתם עומדים מול תיבה נעולה בקוד בן 3 ספרות.\nעל התיבה מופיעים חמישה רמזים:",
                Clues =
                [
                    new() { Code = "682", Text = "ספרה אחת נכונה נמצאת במקום הנכון." },
                    new() { Code = "614", Text = "ספרה אחת נכונה, אבל נמצאת במקום הלא נכון." },
                    new() { Code = "206", Text = "שתי ספרות נכונות, אבל שתיהן במקומות הלא נכונים." },
                    new() { Code = "738", Text = "אף ספרה אינה נכונה." },
                    new() { Code = "780", Text = "ספרה אחת נכונה, אבל נמצאת במקום הלא נכון." },
                ],
                Question = "מהו הקוד שפותח את התיבה?",
                ReplyNote = "יש לכם תשובה? השיבו למייל הזה עם הקוד שפתחתם!",
            },
        ],
        Links = new(),
        Offer = new(),
        Cta = new() { Label = "למשחק סוד פך השמן", Url = "/games/hanukkah-oil?coupon=PORTAL10" },
    };
}

public sealed class NewsletterIntro
{
    public bool Show { get; set; } = true;
    /// <summary>The ribbon title ("ברוכים הבאים!").</summary>
    public string Title { get; set; } = "";
    /// <summary>An optional bold line under the ribbon.</summary>
    public string Lead { get; set; } = "";
    public string Text { get; set; } = "";
}

/// <summary>
/// One block of the main area. "text": a title and paragraphs (a line starting with "•" or "-" is a bullet, **x** is bold).
/// "riddle": the same, then numbered code rows (code + clue), a question bar and a reply line.
/// </summary>
public sealed class NewsletterSection
{
    public bool Show { get; set; } = true;
    public string Kind { get; set; } = "text";
    public string Icon { get; set; } = "";
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    public List<NewsletterClue> Clues { get; set; } = [];
    public string Question { get; set; } = "";
    public string ReplyNote { get; set; } = "";
}

public sealed class NewsletterClue
{
    public string Code { get; set; } = "";
    public string Text { get; set; } = "";
}

/// <summary>
/// The share area: one button that opens a page of the site showing the recipient's own existing personal link, with
/// a copy button (an email cannot copy to the clipboard itself). Left out for a recipient without an active link.
/// </summary>
public sealed class NewsletterLinks
{
    public const string OldTitle = "הקישורים האישיים שלכם";
    public const string OldNote = "לשיתוף עם חברים ומשפחה";

    public bool Show { get; set; } = true;
    public string Title { get; set; } = "הקישור האישי שלכם";
    public string Note { get; set; } = "נהניתם מהחוויה? שתפו את החברים והמשפחה!";
    public string ButtonLabel { get; set; } = "📋 העתקת הקישור האישי";
    public string Footnote { get; set; } = "שתפו והזמינו גם אותם לגלות את עולם PORTAL-X";
    /// <summary>Show the site's raffle line in the share area (only while the draw is still ahead).</summary>
    public bool ShowRaffle { get; set; } = true;
}

public sealed class NewsletterOffer
{
    public bool Show { get; set; } = true;
    public string Title { get; set; } = "הטבה מיוחדת";
    public string Subtitle { get; set; } = "לחברי סודות הפורטל";
    public decimal Percent { get; set; } = 10;
    public string GameName { get; set; } = "סוד פך השמן";
    public string Code { get; set; } = "PORTAL10";
    /// <summary>The group's fixed coupon picture (https), shown above the code; the code is always live text as well.</summary>
    public string ImageUrl { get; set; } = "";
    public string Note { get; set; } = "";
}

public sealed class NewsletterCta
{
    public bool Show { get; set; } = true;
    public string Label { get; set; } = "";
    /// <summary>"/page" on the site, or a full https address.</summary>
    public string Url { get; set; } = "/";
}

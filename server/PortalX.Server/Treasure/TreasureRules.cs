using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace PortalX.Server.Treasure;

/// <summary>The kinds of prize the chest knows. A new kind is a new constant plus its handling in TreasureService.</summary>
public static class TreasureKinds
{
    public const string None = "none";
    public const string Percent = "percent";
    public const string Gift = "gift";
    public static readonly string[] All = [None, Percent, Gift];
}

/// <summary>The opening animations the admin can choose for a prize.</summary>
public static class TreasureAnimations
{
    public static readonly string[] All = ["chest", "glow", "simple"];
}

/// <summary>
/// One prize of the chest, as the admin configured it. Weight is in basis points (1 = 0.01%); the weights of the active
/// prizes add up to exactly 10000 (100%).
/// </summary>
public sealed record TreasurePrize(
    string Key, string Kind, string Name, int Weight, bool Active = true,
    decimal? DiscountPercent = null, int ValidityDays = 30, int? MaxWins = null, decimal? BudgetIls = null,
    string Title = "", string Message = "", string Animation = "chest");

/// <summary>The fixed rules of the draw, apart from the database so they can be tested on their own.</summary>
public static partial class TreasureRules
{
    public const int TotalWeight = 10000;
    /// <summary>The built-in "no prize" used when nothing else can be given.</summary>
    public const string NoneKey = "none";

    public const string SurpriseTitle = "רגע! יש לנו הפתעה מיוחדת בשבילכם!";

    /// <summary>The defaults of the spec: no prize 80%, 10% off 12%, 20% off 5%, 30% off 2%, a gift game 1%.</summary>
    public static List<TreasurePrize> Defaults() =>
    [
        new(NoneKey, TreasureKinds.None, "ללא פרס", 8000, Title: "תודה שבחרתם ב-PORTAL X!",
            Message: "ההרפתקה שלכם מחכה. נתראה בפורטל!", Animation: "simple"),
        new("off-10", TreasureKinds.Percent, "10% הנחה", 1200, DiscountPercent: 10, Title: "זכיתם ב-10% הנחה!",
            Message: "קופון אישי לרכישה הבאה שלכם באתר."),
        new("off-20", TreasureKinds.Percent, "20% הנחה", 500, DiscountPercent: 20, Title: "זכיתם ב-20% הנחה!",
            Message: "קופון אישי לרכישה הבאה שלכם באתר."),
        new("off-30", TreasureKinds.Percent, "30% הנחה", 200, DiscountPercent: 30, Title: "זכיתם ב-30% הנחה!",
            Message: "קופון אישי לרכישה הבאה שלכם באתר.", Animation: "glow"),
        new("gift", TreasureKinds.Gift, "משחק מתנה", 100, Title: "זכיתם במשחק מתנה!",
            Message: "משחק שלם נוסף, עלינו. אפשר לפתוח אותו מתי שתרצו.", Animation: "glow"),
    ];

    /// <summary>The default fallback: the 30% coupon (an owner of every gift game still gets a real prize).</summary>
    public const string DefaultFallback = "off-30";

    /// <summary>A uniform number in [0, 10000) from the operating system's cryptographic generator.</summary>
    public static int Roll() => RandomNumberGenerator.GetInt32(TotalWeight);

    /// <summary>The active prize whose weight range holds the roll. The prizes must be valid (see <see cref="Validate"/>).</summary>
    public static TreasurePrize Pick(IReadOnlyList<TreasurePrize> prizes, int roll)
    {
        if (roll is < 0 or >= TotalWeight) throw new ArgumentOutOfRangeException(nameof(roll));
        var at = 0;
        foreach (var p in prizes.Where(p => p.Active && p.Weight > 0))
        {
            at += p.Weight;
            if (roll < at) return p;
        }
        throw new InvalidOperationException("the active weights do not add up to 100%");
    }

    [GeneratedRegex("^[a-z0-9-]{2,32}$")]
    private static partial Regex KeyPattern();

    /// <summary>Null when the settings may be saved; otherwise the reason, in Hebrew, for the admin.</summary>
    public static string? Validate(string fallbackKey, IReadOnlyList<TreasurePrize> prizes)
    {
        if (prizes.Count is 0 or > 20) return "צריך להגדיר בין פרס אחד ל-20 פרסים.";
        if (prizes.Select(p => p.Key).Distinct().Count() != prizes.Count) return "לכל פרס צריך להיות מזהה ייחודי.";
        foreach (var p in prizes)
        {
            if (p.Key == null || !KeyPattern().IsMatch(p.Key)) return "מזהה פרס יכול להכיל 2–32 אותיות קטנות באנגלית, ספרות ומקף.";
            if (!TreasureKinds.All.Contains(p.Kind)) return $"סוג הפרס של „{p.Name}” אינו מוכר.";
            if (string.IsNullOrWhiteSpace(p.Name) || p.Name.Trim().Length > 60) return "שם הפרס צריך להיות באורך 1–60 תווים.";
            if (p.Weight is < 0 or > TotalWeight) return $"הסיכוי של „{p.Name}” צריך להיות בין 0% ל-100%.";
            if ((p.Title?.Length ?? 0) > 120 || (p.Message?.Length ?? 0) > 400) return $"הטקסטים של „{p.Name}” ארוכים מדי (כותרת עד 120 תווים, הסבר עד 400).";
            if (!TreasureAnimations.All.Contains(p.Animation)) return $"סוג האנימציה של „{p.Name}” אינו מוכר.";
            if (p.MaxWins is < 0) return "מגבלת החלוקה אינה יכולה להיות שלילית.";
            if (p.BudgetIls is < 0) return "מגבלת התקציב אינה יכולה להיות שלילית.";
            if (p.Kind == TreasureKinds.Percent)
            {
                if (p.DiscountPercent is not { } d || d <= 0 || d >= 100 || decimal.Round(d, 2) != d) return $"אחוז ההנחה של „{p.Name}” צריך להיות בין 1 ל-99.";
                if (p.ValidityDays is < 1 or > 365) return $"תוקף הקופון של „{p.Name}” צריך להיות בין יום אחד ל-365 ימים.";
            }
        }
        var sum = prizes.Where(p => p.Active).Sum(p => p.Weight);
        if (sum != TotalWeight)
            return $"סכום הסיכויים של הפרסים הפעילים הוא {sum / 100m:0.##}% ולא 100%. תקנו אותו לפני השמירה.";
        if (fallbackKey != NoneKey)
        {
            var f = prizes.FirstOrDefault(p => p.Key == fallbackKey);
            if (f == null || !f.Active) return "פרס הגיבוי צריך להיות פרס פעיל או „ללא פרס”.";
            if (f.Kind == TreasureKinds.Gift) return "פרס הגיבוי אינו יכול להיות משחק מתנה (הוא מופעל בדיוק כשאין משחק מתאים).";
        }
        return null;
    }

    /// <summary>The prize behind a key, or the built-in "no prize".</summary>
    public static TreasurePrize Find(IReadOnlyList<TreasurePrize> prizes, string key) =>
        prizes.FirstOrDefault(p => p.Key == key) ?? new TreasurePrize(NoneKey, TreasureKinds.None, "ללא פרס", 0, Animation: "simple");
}

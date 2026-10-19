using System.Text.RegularExpressions;

namespace PortalX.Server.Game;

/// <summary>
/// Keeps chat and nicknames clean and respectful (spec: clean language for the Haredi audience)
/// and prevents sharing personal details such as links or phone numbers (spec §20).
/// </summary>
public static partial class ContentFilter
{
    public const int MaxChatLength = 140;

    // Deliberately conservative list of disrespectful words; matched on normalized text.
    private static readonly string[] Blocked =
    [
        "טיפש", "מטומטם", "אידיוט", "דביל", "סתום", "שתוק", "מפגר", "זבל", "חרא", "קקי", "שונא אותך", "תמות", "מכוער",
        "stupid", "idiot", "dumb", "shut up", "i hate", "ugly", "loser",
    ];

    [GeneratedRegex(@"(https?://|www\.|\.com|\.co\.il|\.net|\.org|@)", RegexOptions.IgnoreCase)]
    private static partial Regex LinkPattern();

    [GeneratedRegex(@"\d[\d\-\s]{6,}\d")]
    private static partial Regex PhonePattern();

    public static bool ContainsBlocked(string text)
    {
        var t = text.ToLowerInvariant();
        return Blocked.Any(w => t.Contains(w));
    }

    /// <summary>Returns null when the message may be sent, otherwise a Hebrew explanation.</summary>
    public static string? Check(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "ההודעה ריקה.";
        if (text.Length > MaxChatLength) return $"ההודעה ארוכה מדי (עד {MaxChatLength} תווים).";
        if (ContainsBlocked(text)) return "כדאי לנסח את ההודעה בלשון נקייה ומכבדת.";
        if (LinkPattern().IsMatch(text)) return "אסור לשלוח קישורים או כתובות בצ׳אט.";
        if (PhonePattern().IsMatch(text)) return "לשמירה על פרטיות — אין לשלוח מספרי טלפון או מספרים ארוכים.";
        return null;
    }

    public static readonly Dictionary<string, string> Emotes = new()
    {
        ["thumbs"] = "👍",
        ["idea"] = "💡",
        ["think"] = "🤔",
        ["clap"] = "👏",
        ["star"] = "⭐",
        ["eyes"] = "👀",
        ["key"] = "🗝️",
        ["smile"] = "🙂",
    };

    public static readonly string[] QuickPhrases =
    [
        "מצאתי רמז!", "בואו לכאן", "מישהו ראה מפתח?", "כל הכבוד!", "אני חושב שהבנתי", "צריך עזרה", "מה אתם רואים במראה?", "מוכן!",
    ];
}

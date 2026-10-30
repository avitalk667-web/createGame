using System.Globalization;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

/// <summary>
/// When a game may be bought: "open", "scheduled" (its opening time, in Israel time, has not come yet) or "paused" by the
/// admin. Checked on the server for every new order, checkout and payment start — hiding a button is never enough.
/// A product without an opening time and not paused behaves exactly as before.
/// </summary>
public static class SaleWindow
{
    public const string Open = "open";
    public const string Scheduled = "scheduled";
    public const string Paused = "paused";

    private static readonly TimeZoneInfo Israel = FindIsrael();

    private static TimeZoneInfo FindIsrael()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
        catch (Exception) { return TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time"); }
    }

    public static string State(Product p, DateTime nowUtc) =>
        p.SalePaused ? Paused : p.SaleOpensAt is { } at && nowUtc < at ? Scheduled : Open;

    /// <summary>Shown on the site and in admin: whether a scheduled product appears before it opens.</summary>
    public static bool Visible(Product p, DateTime nowUtc) => State(p, nowUtc) != Scheduled || p.ShowBeforeSale;

    /// <summary>An Israel date ("2026-12-13") and time ("20:00") as a UTC instant; null when either is missing or invalid.</summary>
    public static DateTime? FromIsrael(string? date, string? time)
    {
        if (string.IsNullOrWhiteSpace(date) || string.IsNullOrWhiteSpace(time)) return null;
        if (!DateTime.TryParseExact($"{date.Trim()} {time.Trim()}", ["yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm"], CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var local)) return null;
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Israel);
    }

    public static DateTime ToIsrael(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Israel);

    /// <summary>"13.12.2026 בשעה 20:00" in Israel time.</summary>
    public static string Label(DateTime utc)
    {
        var l = ToIsrael(utc);
        return $"{l:dd.MM.yyyy} בשעה {l:HH:mm}";
    }

    /// <summary>The reason a purchase is refused now, or null when the game is open for purchase.</summary>
    public static ServiceError? Refusal(Product p, DateTime nowUtc) => State(p, nowUtc) switch
    {
        Paused => new ServiceError(409, "sale-paused", "המכירה של המשחק הזה מושהית כרגע. נסו שוב מאוחר יותר."),
        Scheduled => new ServiceError(409, "sale-not-open", $"המכירה תיפתח בקרוב — ב־{Label(p.SaleOpensAt!.Value)}."),
        _ => null,
    };
}

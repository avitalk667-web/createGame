using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using PortalX.Server.Domain;

namespace PortalX.Server.Challenge;

/// <summary>The fixed rules of a challenge campaign, apart from the database so they can be tested on their own.</summary>
public static class ChallengeRules
{
    /// <summary>Upper-case letters and digits without look-alikes (no I, O, 0, 1): 32 symbols.</summary>
    public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    public const string Prefix = "PX-";
    /// <summary>8 random symbols = 40 bits (about a trillion codes); guessing is also limited per address.</summary>
    public const int RandomLength = 8;

    /// <summary>A new random personal code, e.g. "PX-7KQ2M9XA" (a cryptographic generator, never a counter).</summary>
    public static string NewCode()
    {
        var chars = new char[RandomLength];
        for (var i = 0; i < chars.Length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return Prefix + new string(chars);
    }

    /// <summary>The minimum is inclusive: with 241 a final score of 241 qualifies and 240 does not.</summary>
    public static bool Qualifies(int finalScore, int minimumScore) => finalScore >= minimumScore;

    /// <summary>
    /// ValidityDays full calendar days after it was issued, at the same Israel clock time (01.03 10:00 → 09.03 10:00), as
    /// UTC. That is 192 hours for 8 days — except across a summer/winter clock change, where the Israel time stays the same
    /// (20.03 12:15 → 28.03 12:15 although the clocks moved on 27.03).
    /// </summary>
    public static DateTime ExpiresAt(DateTime issuedUtc, int validityDays)
    {
        var zone = Israel();
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(issuedUtc, DateTimeKind.Utc), zone).AddDays(validityDays);
        local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        // a clock time skipped when summer time starts (02:00–03:00) does not exist: the next hour that does
        if (zone.IsInvalidTime(local)) local = local.AddHours(1);
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    /// <summary>Expired from the very moment of its expiry onward.</summary>
    public static bool IsExpired(DateTime expiresAtUtc, DateTime nowUtc) => nowUtc >= expiresAtUtc;

    /// <summary>The personal coupon's state: cancelled, redeemed, expired or active.</summary>
    public static string Status(Coupon c, bool redeemed, DateTime nowUtc) =>
        c.CancelledAt != null ? "cancelled" : redeemed ? "redeemed" : c.EndsAt is { } end && IsExpired(end, nowUtc) ? "expired" : "active";

    private static TimeZoneInfo Israel()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
        catch (Exception)
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time"); }
            catch (Exception) { return TimeZoneInfo.CreateCustomTimeZone("IL", TimeSpan.FromHours(2), "IL", "IL"); }
        }
    }

    public static DateTime ToIsrael(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Israel());

    /// <summary>"09.03.2026 בשעה 10:00" in Israel time (summer or winter time as it is on that date).</summary>
    public static string FormatIsrael(DateTime utc)
    {
        var local = ToIsrael(utc);
        return local.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture) + " בשעה " + local.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>The browser id is never stored; only its hash, to keep one coupon per browser.</summary>
    public static string? BrowserKey(string? browserId) =>
        string.IsNullOrEmpty(browserId) ? null : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("challenge:" + browserId)));

    /// <summary>"d***@gmail.com" — enough for the player to recognize their address, not enough to reveal it.</summary>
    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0) return "***";
        return email[0] + new string('*', Math.Min(3, Math.Max(1, at - 1))) + email[at..];
    }
}

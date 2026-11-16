using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Demo;

/// <summary>What the browser learns about its own session (no ids, no answer).</summary>
public sealed record DemoState(
    string[] Inspected, string[] Hints, int Attempts, bool Completed, int CooldownSeconds, string Variant, int? Seconds);

public sealed record DemoCodeReply(bool Ok, string Message, DemoState State, bool AlreadyCompleted = false);

/// <summary>
/// "טעימה מהפורטל": the anonymous session of the free taste. Every change goes through here and is keyed by the hash of
/// the browser's own cookie token, so one browser can never read or change another's session. The riddle's code is only
/// here: the browser sends a guess and is told whether it opened the door. Counters that must not double (an object
/// examined, a hint, the completion) are changed with one conditional UPDATE each, so two tabs or a double click count once.
/// </summary>
public sealed class DemoService(PortalDbContext db, IConfiguration config, ILogger<DemoService> logger)
{
    public const string Cookie = "px_demo";
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);
    /// <summary>"הסוד שמאחורי השעון": compass 2, clock 7, key 4, letter 1.</summary>
    private const string Code = "2741";
    public const int WrongBeforeCooldown = 5;
    public static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(30);

    public static readonly string[] Items = { "letter", "compass", "clock", "key" };
    public static int ItemBit(string item) => Array.IndexOf(Items, item) is var i and >= 0 ? 1 << i : 0;

    public static readonly string[] HintTexts =
    {
        "המכתב אינו מציג את הקוד עצמו, אלא את הסדר שבו צריך לקרוא את הסימנים.",
        "התחילו במצפן, עברו לשעון, המשיכו למפתח וסיימו במכתב.",
    };

    public const string WrongMessage = "זה עדיין לא הסוד הנכון. חפשו שוב בין הרמזים.";
    public const string RightMessage = "פתחתם את השער! הצלחתם לפענח את סוד החדר.";

    private static readonly HashSet<string> Devices = new() { "desktop", "mobile", "tablet" };
    public static string CleanDevice(string? d) => d != null && Devices.Contains(d) ? d : "desktop";

    public static CookieOptions CookieOptions(HttpRequest request) => new()
    {
        HttpOnly = true,
        Secure = request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        IsEssential = true,
        MaxAge = Lifetime,
    };

    /// <summary>The variants on offer (Demo:Variants, e.g. "A,B"); a session keeps the one it got for its whole life.</summary>
    private string VariantFor(string token)
    {
        var list = (config["Demo:Variants"] ?? "A").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(v => v.Length is > 0 and <= 8).DefaultIfEmpty("A").ToArray();
        return list[Convert.ToInt32(RoomService.Hash(token)[..6], 16) % list.Length];
    }

    // ------------------------------------------------------------------ reading

    public async Task<DemoSession?> FindAsync(string? token, DateTime now)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 64) return null;
        var hash = RoomService.Hash(token);
        return await db.DemoSessions.FirstOrDefaultAsync(s => s.TokenHash == hash && s.CreatedAt > now - Lifetime);
    }

    public static DemoState StateOf(DemoSession s, DateTime now) => new(
        Items.Where(i => (s.InspectedMask & ItemBit(i)) != 0).ToArray(),
        HintTexts.Take(s.HintsUsed).ToArray(),
        s.CodeAttempts,
        s.CompletedAt != null,
        s.CooldownUntil is { } until && until > now ? (int)Math.Ceiling((until - now).TotalSeconds) : 0,
        s.Variant,
        s.CompletedAt is { } done ? (int)(done - s.CreatedAt).TotalSeconds : null);

    // ------------------------------------------------------------------ changes

    /// <summary>
    /// Enters the room: the browser's own session when it has a live one (a refresh, coming back later), else a new one
    /// (demo_started). Returns the token to keep in the cookie.
    /// </summary>
    public async Task<(DemoSession Session, string Token, bool Created)> StartAsync(string? token, string? device, Guid? referralLinkId, DateTime now)
    {
        var existing = await FindAsync(token, now);
        if (existing != null)
        {
            existing.LastSeenAt = now;
            await db.SaveChangesAsync();
            return (existing, token!, false);
        }
        var fresh = RoomService.NewToken();
        var s = new DemoSession
        {
            Id = Guid.NewGuid(), TokenHash = RoomService.Hash(fresh), CreatedAt = now, LastSeenAt = now,
            Device = CleanDevice(device), Variant = VariantFor(fresh), ReferralLinkId = referralLinkId, LastEvent = "demo_started",
        };
        db.DemoSessions.Add(s);
        db.DemoEvents.Add(Event(s, "demo_started", now));
        await db.SaveChangesAsync();
        logger.LogInformation("Demo session {Id} started ({Device}, variant {Variant})", s.Id, s.Device, s.Variant);
        return (s, fresh, true);
    }

    /// <summary>An object was examined; the first time per object is recorded (demo_item_inspected).</summary>
    public async Task<DemoState?> InspectAsync(string? token, string? item, DateTime now)
    {
        var s = await FindAsync(token, now);
        if (s == null) return null;
        var bit = ItemBit(item ?? "");
        if (bit != 0)
        {
            var changed = await db.DemoSessions.Where(x => x.Id == s.Id && (x.InspectedMask & bit) == 0)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.InspectedMask, x => x.InspectedMask | bit)
                    .SetProperty(x => x.LastSeenAt, now).SetProperty(x => x.LastEvent, "demo_item_inspected"));
            if (changed == 1)
            {
                db.DemoEvents.Add(Event(s, "demo_item_inspected", now, value: Array.IndexOf(Items, item)));
                await db.SaveChangesAsync();
            }
        }
        return await StateAsync(s.Id, now);
    }

    /// <summary>The next written hint, at most two in all (demo_hint_requested, with the hint's number).</summary>
    public async Task<DemoState?> HintAsync(string? token, DateTime now)
    {
        var s = await FindAsync(token, now);
        if (s == null) return null;
        var used = s.HintsUsed;
        if (used < HintTexts.Length && s.CompletedAt == null)
        {
            var changed = await db.DemoSessions.Where(x => x.Id == s.Id && x.HintsUsed == used)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.HintsUsed, used + 1)
                    .SetProperty(x => x.LastSeenAt, now).SetProperty(x => x.LastEvent, "demo_hint_requested"));
            if (changed == 1)
            {
                // where in the room the player asked: the number of objects examined so far
                db.DemoEvents.Add(Event(s, "demo_hint_requested", now, value: (used + 1) * 10 + BitCount(s.InspectedMask)));
                await db.SaveChangesAsync();
            }
        }
        return await StateAsync(s.Id, now);
    }

    /// <summary>
    /// A guess at the keypad. The answer is decided here; a right code completes the session once (demo_completed), and a
    /// completed session answers every later guess with its success without counting anything again.
    /// </summary>
    public async Task<DemoCodeReply?> TryCodeAsync(string? token, string? code, DateTime now)
    {
        var s = await FindAsync(token, now);
        if (s == null) return null;
        if (s.CompletedAt != null) return new DemoCodeReply(true, RightMessage, StateOf(s, now), AlreadyCompleted: true);
        if (s.CooldownUntil is { } until && until > now)
            return new DemoCodeReply(false, $"לוח המקשים נח לרגע. נסו שוב בעוד {(int)Math.Ceiling((until - now).TotalSeconds)} שניות.", StateOf(s, now));
        var guess = (code ?? "").Trim();
        if (guess.Length != 4 || !guess.All(char.IsAsciiDigit))
            return new DemoCodeReply(false, "הקוד הוא ארבע ספרות.", StateOf(s, now));

        s.CodeAttempts++;
        s.LastSeenAt = now;
        db.DemoEvents.Add(Event(s, "demo_code_attempt", now, value: s.CodeAttempts));
        if (guess != Code)
        {
            s.WrongStreak++;
            s.LastEvent = "demo_code_attempt";
            if (s.WrongStreak >= WrongBeforeCooldown)
            {
                s.WrongStreak = 0;
                s.CooldownUntil = now + Cooldown;
            }
            await db.SaveChangesAsync();
            return new DemoCodeReply(false, WrongMessage, StateOf(s, now));
        }
        await db.SaveChangesAsync();
        // the completion itself: one conditional update, so two tabs pressing at once complete it once
        var completed = await db.DemoSessions.Where(x => x.Id == s.Id && x.CompletedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.CompletedAt, now).SetProperty(x => x.WrongStreak, 0)
                .SetProperty(x => x.LastEvent, "demo_completed"));
        if (completed == 1)
        {
            db.DemoEvents.Add(Event(s, "demo_completed", now, value: (int)(now - s.CreatedAt).TotalSeconds));
            await db.SaveChangesAsync();
            logger.LogInformation("Demo session {Id} completed in {Seconds}s", s.Id, (int)(now - s.CreatedAt).TotalSeconds);
        }
        var state = (await StateAsync(s.Id, now))!;
        return new DemoCodeReply(true, RightMessage, state, AlreadyCompleted: completed == 0);
    }

    private async Task<DemoState?> StateAsync(Guid id, DateTime now)
    {
        var s = await db.DemoSessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return s == null ? null : StateOf(s, now);
    }

    private static int BitCount(int v) => System.Numerics.BitOperations.PopCount((uint)v);

    private static DemoEvent Event(DemoSession s, string type, DateTime now, string? productId = null, int? value = null) => new()
    {
        SessionId = s.Id, Type = type, At = now, ProductId = productId, Value = value, Device = s.Device, Variant = s.Variant, ReferralLinkId = s.ReferralLinkId,
    };
}

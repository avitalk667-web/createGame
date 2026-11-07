using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Security;

/// <summary>
/// The visitor's real internet address behind Render's proxies. Render (with Cloudflare in front of it) appends the
/// address it received the request from to X-Forwarded-For and keeps whatever the visitor sent, so only the right end
/// of the header can be trusted: the address is the rightmost entry that is not one of the proxies themselves
/// (Render's internal network, Cloudflare). Anything a visitor writes into the header stays on its left and is never
/// reached, so it cannot be used to pretend to be someone else.
/// </summary>
public static class ClientIp
{
    public const string OriginalPeerItem = "px.peer";

    /// <summary>Addresses that are never a visitor: private and internal networks, and Cloudflare's published ranges.</summary>
    private static readonly System.Net.IPNetwork[] Proxies = new[]
    {
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10", "0.0.0.0/8",
        "::1/128", "fc00::/7", "fe80::/10",
        // https://www.cloudflare.com/ips/
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
        "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
        "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
        "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
    }.Select(System.Net.IPNetwork.Parse).ToArray();

    public static bool IsProxy(IPAddress ip, IReadOnlyList<System.Net.IPNetwork> extra) =>
        Proxies.Any(n => n.Contains(ip)) || extra.Any(n => n.Contains(ip));

    private static IPAddress Normal(IPAddress ip) => ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip;

    private static IPAddress? Parse(string s)
    {
        s = s.Trim().Trim('"');
        if (IPAddress.TryParse(s, out var ip)) return Normal(ip);
        // "1.2.3.4:5678" or "[2001:db8::1]:443"
        return IPEndPoint.TryParse(s, out var ep) ? Normal(ep.Address) : null;
    }

    /// <summary>
    /// The visitor's address. When the request came through a proxy (X-Forwarded-For is present) the direct peer is
    /// that proxy — on Render the server cannot be reached any other way — so the header is read from its right end.
    /// </summary>
    public static IPAddress? Resolve(HttpContext ctx, IReadOnlyList<System.Net.IPNetwork> extraProxies)
    {
        var peer = ctx.Connection.RemoteIpAddress is { } p ? Normal(p) : null;
        var entries = ctx.Request.Headers["X-Forwarded-For"].SelectMany(v => (v ?? "").Split(',')).Where(s => s.Trim().Length > 0).ToList();
        if (entries.Count == 0) return peer;
        IPAddress? leftmost = null;
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            var ip = Parse(entries[i]);
            // something that is not an address where a proxy should have written one: do not guess
            if (ip == null) return leftmost ?? peer;
            if (!IsProxy(ip, extraProxies)) return ip;
            leftmost = ip;
        }
        // every entry is an internal address (a local setup): the one furthest from this server
        return leftmost ?? peer;
    }

    /// <summary>
    /// The key a usage limit counts by: the IPv4 address, or the /64 network of an IPv6 address (one home or phone
    /// usually holds a whole /64, so counting single IPv6 addresses would let one device look like many).
    /// </summary>
    public static string Key(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress;
        if (ip == null) return "unknown";
        ip = Normal(ip);
        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6) return ip.ToString();
        var b = ip.GetAddressBytes();
        for (var i = 8; i < 16; i++) b[i] = 0;
        return new IPAddress(b) + "/64";
    }

    /// <summary>Sets the connection's address to the visitor's, for every limit and log that reads it.</summary>
    public static IApplicationBuilder UseClientIp(this IApplicationBuilder app)
    {
        var config = app.ApplicationServices.GetRequiredService<IConfiguration>();
        // more proxy networks, if Render ever adds hops from other ranges ("ClientIp:TrustedProxies": "a/b,c/d")
        var extra = (config["ClientIp:TrustedProxies"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(System.Net.IPNetwork.Parse).ToArray();
        return app.Use(async (ctx, next) =>
        {
            ctx.Items[OriginalPeerItem] = ctx.Connection.RemoteIpAddress?.ToString();
            ctx.Connection.RemoteIpAddress = Resolve(ctx, extra);
            await next();
        });
    }
}

/// <summary>
/// An anonymous, stable id for each browser: a random value in an HttpOnly cookie, signed with a server key, with no
/// personal details. It lets the free game be limited per person instead of per shared address (a phone network or an
/// office Wi-Fi serves hundreds of people from one address). Ids are issued only by the server; one that was invented
/// or altered is treated as no id at all. The key is kept in the database (AppSecrets), so ids survive restarts.
/// </summary>
public sealed class BrowserIdentity(IServiceScopeFactory scopes, ILogger<BrowserIdentity> log)
{
    public const string Cookie = "px_vid";
    private const string Item = "px.browser";
    private const string SecretName = "browser-id-key";
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(365);
    private byte[]? _key;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>The id this request brought in a valid cookie, or null (no cookie, or one the server did not sign).</summary>
    public static string? Of(HttpContext ctx) => ctx.Items.TryGetValue(Item, out var v) ? v as string : null;

    public async Task<byte[]?> KeyAsync()
    {
        if (_key != null) return _key;
        await _gate.WaitAsync();
        try
        {
            if (_key != null) return _key;
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            var row = await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Name == SecretName);
            if (row == null)
            {
                row = new AppSecret { Name = SecretName, Value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), CreatedAt = DateTime.UtcNow };
                db.AppSecrets.Add(row);
                try { await db.SaveChangesAsync(); }
                catch (DbUpdateException)
                {
                    // created at the same moment elsewhere: use that one
                    db.ChangeTracker.Clear();
                    row = await db.AppSecrets.AsNoTracking().FirstAsync(s => s.Name == SecretName);
                }
            }
            return _key = Convert.FromBase64String(row.Value);
        }
        catch (Exception e)
        {
            log.LogWarning(e, "The browser id key could not be loaded; requests are counted by address only for now");
            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Mac(byte[] key, string id) => B64(HMACSHA256.HashData(key, Encoding.ASCII.GetBytes("browser:" + id))[..16]);

    public static string Issue(byte[] key)
    {
        var id = B64(RandomNumberGenerator.GetBytes(16));
        return id + "." + Mac(key, id);
    }

    /// <summary>The id inside a cookie value, or null when it is malformed or its signature does not match.</summary>
    public static string? Verify(byte[] key, string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 80) return null;
        var parts = value.Split('.');
        if (parts.Length != 2 || parts[0].Length != 22) return null;
        var expected = Encoding.ASCII.GetBytes(Mac(key, parts[0]));
        var given = Encoding.ASCII.GetBytes(parts[1]);
        return CryptographicOperations.FixedTimeEquals(expected, given) ? parts[0] : null;
    }

    /// <summary>Reads the id of every API request, and gives a browser without one its id with the response.</summary>
    public async Task HandleAsync(HttpContext ctx, Func<Task> next)
    {
        var path = ctx.Request.Path;
        if (!path.StartsWithSegments("/api") || path.StartsWithSegments("/api/health") || path.StartsWithSegments("/api/version"))
        {
            await next();
            return;
        }
        var key = await KeyAsync();
        if (key != null)
        {
            var id = Verify(key, ctx.Request.Cookies[Cookie]);
            if (id != null) ctx.Items[Item] = id;
            else
                ctx.Response.Cookies.Append(Cookie, Issue(key), new CookieOptions
                {
                    HttpOnly = true,
                    Secure = ctx.Request.IsHttps,
                    SameSite = SameSiteMode.Lax,
                    Path = "/",
                    MaxAge = Lifetime,
                    IsEssential = true,
                });
        }
        await next();
    }
}

/// <summary>
/// Counts uses in a sliding window per key (a browser, an address) and refuses past a limit, telling exactly when the
/// next use is allowed. Several limits are checked together and a use counts toward all of them only when every one
/// allows it, so a refused request never uses anything up. Kept in this server's memory, like the rest of the game's
/// live state (the rooms' locks and connections): the site runs as a single instance.
/// </summary>
public sealed class UsageLimiter(TimeProvider clock)
{
    public UsageLimiter() : this(TimeProvider.System) { }

    public readonly record struct Rule(string Key, int Limit, TimeSpan Window);
    public readonly record struct Verdict(bool Allowed, int Refused, TimeSpan RetryAfter);

    private sealed class Entry(TimeSpan window)
    {
        public readonly Queue<DateTimeOffset> Uses = new();
        public TimeSpan Window = window;
    }

    /// <summary>Beyond this many tracked keys new browsers are not tracked (their address still is), so memory stays bounded.</summary>
    public int MaxKeys { get; init; } = 300_000;

    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _entries = new();
    private DateTimeOffset _nextSweep;

    public int TrackedKeys { get { lock (_gate) return _entries.Count; } }

    public Verdict TryAcquire(params Rule[] rules)
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            if (now >= _nextSweep) Sweep(now);
            for (var i = 0; i < rules.Length; i++)
            {
                var r = rules[i];
                if (!_entries.TryGetValue(r.Key, out var e)) continue;
                Trim(e, now);
                if (e.Uses.Count >= r.Limit) return new Verdict(false, i, e.Uses.Peek() + r.Window - now);
            }
            for (var i = 0; i < rules.Length; i++)
            {
                var r = rules[i];
                if (!_entries.TryGetValue(r.Key, out var e))
                {
                    if (_entries.Count >= MaxKeys && i < rules.Length - 1) continue; // the last rule is the address: always counted
                    _entries[r.Key] = e = new Entry(r.Window);
                }
                e.Window = r.Window > e.Window ? r.Window : e.Window;
                e.Uses.Enqueue(now);
            }
            return new Verdict(true, -1, TimeSpan.Zero);
        }
    }

    private static void Trim(Entry e, DateTimeOffset now)
    {
        while (e.Uses.Count > 0 && e.Uses.Peek() <= now - e.Window) e.Uses.Dequeue();
    }

    private void Sweep(DateTimeOffset now)
    {
        _nextSweep = now + TimeSpan.FromMinutes(1);
        foreach (var (k, e) in _entries.ToList())
        {
            Trim(e, now);
            if (e.Uses.Count == 0) _entries.Remove(k);
        }
    }

    /// <summary>"בעוד 23 דקות" — the real wait, in words.</summary>
    public static string Wait(TimeSpan t)
    {
        if (t.TotalSeconds < 60) return "בעוד פחות מדקה";
        var m = (int)Math.Ceiling(t.TotalMinutes);
        return m switch { 1 => "בעוד דקה", 2 => "בעוד שתי דקות", >= 60 => "בעוד שעה", _ => $"בעוד {m} דקות" };
    }

    public static IResult TooMany(HttpContext ctx, string code, string message, TimeSpan retryAfter)
    {
        ctx.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
        return Results.Json(new ApiError(code, message), statusCode: StatusCodes.Status429TooManyRequests);
    }
}

/// <summary>The limits of the public game endpoints, per browser first and per address as a looser second layer.</summary>
public static class UsageLimits
{
    private static int Config(HttpContext ctx, string key, int fallback) =>
        ctx.RequestServices.GetRequiredService<IConfiguration>().GetValue(key, fallback);

    public const string FreeBrowserCode = "free-game-limit";
    public const string FreeNetworkCode = "free-game-network-limit";

    /// <summary>
    /// The free trial game: 5 an hour per browser; 300 an hour per address as a safety net for a whole network; and,
    /// for requests without a browser id (scripts, or cookies deleted before every request), 30 an hour per address.
    /// </summary>
    public static UsageLimiter.Verdict FreeGame(HttpContext ctx, UsageLimiter limiter, out string code, out string message)
    {
        var ip = ClientIp.Key(ctx);
        var browser = BrowserIdentity.Of(ctx);
        var hour = TimeSpan.FromHours(1);
        var perBrowser = Config(ctx, "RateLimits:FreeGamesPerBrowserPerHour", 5);
        var rules = browser != null
            ? new[] { new UsageLimiter.Rule("fg:b:" + browser, perBrowser, hour), new UsageLimiter.Rule("fg:ip:" + ip, Config(ctx, "RateLimits:FreeGamesPerHour", 300), hour) }
            : new[] { new UsageLimiter.Rule("fg:new:" + ip, Config(ctx, "RateLimits:FreeGamesNewBrowserPerHour", 30), hour), new UsageLimiter.Rule("fg:ip:" + ip, Config(ctx, "RateLimits:FreeGamesPerHour", 300), hour) };
        var v = limiter.TryAcquire(rules);
        (code, message) = v.Allowed ? ("", "")
            : browser != null && v.Refused == 0
                ? (FreeBrowserCode, $"פתחתם כבר {perBrowser} משחקי ניסיון בשעה האחרונה. אפשר לפתוח משחק ניסיון נוסף {UsageLimiter.Wait(v.RetryAfter)}.")
                : (FreeNetworkCode, $"נפתחו הרבה משחקי ניסיון מהרשת שלכם בשעה האחרונה. אפשר לפתוח משחק ניסיון נוסף {UsageLimiter.Wait(v.RetryAfter)}.");
        return v;
    }

    /// <summary>
    /// Entering a game (free or paid) and reading an order: 120 a minute per browser and 1200 a minute per address, so
    /// 200 people on one network can all enter at the same moment (each entry is about three requests).
    /// </summary>
    public static async ValueTask<object?> Join(EndpointFilterInvocationContext inv, EndpointFilterDelegate next)
    {
        var ctx = inv.HttpContext;
        var limiter = ctx.RequestServices.GetRequiredService<UsageLimiter>();
        var ip = ClientIp.Key(ctx);
        var browser = BrowserIdentity.Of(ctx);
        var minute = TimeSpan.FromMinutes(1);
        var ipRule = new UsageLimiter.Rule("join:ip:" + ip, Config(ctx, "RateLimits:JoinPerMinute", 1200), minute);
        var v = browser != null
            ? limiter.TryAcquire(new UsageLimiter.Rule("join:b:" + browser, Config(ctx, "RateLimits:JoinPerBrowserPerMinute", 120), minute), ipRule)
            : limiter.TryAcquire(ipRule);
        if (!v.Allowed)
            return UsageLimiter.TooMany(ctx, "rate", $"יותר מדי בקשות בזמן קצר. נסו שוב {UsageLimiter.Wait(v.RetryAfter)}.", v.RetryAfter);
        return await next(inv);
    }
}

/// <summary>
/// The free game a browser opened and has not started yet, so pressing the button again (back, refresh, a retry after
/// a network error, a second tab) returns the same game instead of opening another. The host key is kept only here, in
/// memory, and returned only to the same browser (the signed HttpOnly id) for the same product — never to anyone else.
/// </summary>
public sealed class FreeGameReuse
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    public readonly record struct Opened(Guid RoomId, string Code, string HostClaim, DateTime At);

    private readonly ConcurrentDictionary<string, Opened> _opened = new();
    private readonly SemaphoreSlim[] _locks = Enumerable.Range(0, 64).Select(_ => new SemaphoreSlim(1, 1)).ToArray();

    private static string Key(string browser, string product) => browser + "|" + product;

    /// <summary>One opening at a time per browser, so two quick presses cannot open two games.</summary>
    public SemaphoreSlim LockFor(string browser) => _locks[(int)((uint)browser.GetHashCode() % (uint)_locks.Length)];

    public Opened? Find(string browser, string product, DateTime now) =>
        _opened.TryGetValue(Key(browser, product), out var o) && now - o.At < Lifetime ? o : null;

    public void Remember(string browser, string product, Opened o)
    {
        if (_opened.Count > 50_000)
            foreach (var (k, v) in _opened)
                if (o.At - v.At >= Lifetime) _opened.TryRemove(k, out _);
        _opened[Key(browser, product)] = o;
    }

    public void Forget(string browser, string product) => _opened.TryRemove(Key(browser, product), out _);
}

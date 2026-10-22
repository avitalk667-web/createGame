using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;

namespace PortalX.Server.Admin;

/// <summary>
/// The one administrator account. It lives only in server configuration (environment variables),
/// never in the database or the client: Admin__Username and Admin__PasswordHash.
/// </summary>
public sealed class AdminOptions
{
    public string Username { get; set; } = "";
    /// <summary>ASP.NET Core Identity password hash (PBKDF2). Create it with: PortalX.Server --hash-password</summary>
    public string PasswordHash { get; set; } = "";
    public bool Configured => !string.IsNullOrWhiteSpace(Username) && !string.IsNullOrWhiteSpace(PasswordHash);
}

public static class AdminAuth
{
    public const string Scheme = "admin";
    public const string Policy = "Admin";
    public const string Role = "Admin";
    /// <summary>Every state-changing admin call must carry this header; a cross-site form cannot add it.</summary>
    public const string CsrfHeader = "X-PortalX-Admin";

    private static readonly PasswordHasher<object> Hasher = new();

    public static string HashPassword(string password) => Hasher.HashPassword(new object(), password);

    public static void AddAdminAuth(this IServiceCollection services)
    {
        services.AddAuthentication(Scheme).AddCookie(Scheme, o =>
        {
            o.Cookie.Name = "portalx.admin";
            o.Cookie.HttpOnly = true;
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // https on Render (behind the proxy)
            o.Cookie.Path = "/";
            o.ExpireTimeSpan = TimeSpan.FromHours(8);
            o.SlidingExpiration = true;
            // an API: answer 401/403 instead of redirecting to a login page
            o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
            o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
        });
        services.AddAuthorization(o => o.AddPolicy(Policy, p => p.AddAuthenticationSchemes(Scheme).RequireAuthenticatedUser().RequireRole(Role)));
        services.AddSingleton<AdminLoginGuard>();
    }

    /// <summary>Checks the credentials in constant time; the hash is verified even for a wrong username.</summary>
    public static bool Verify(AdminOptions options, string? username, string? password)
    {
        if (!options.Configured || string.IsNullOrEmpty(password)) return false;
        var userOk = CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(username?.Trim() ?? "")),
            SHA256.HashData(Encoding.UTF8.GetBytes(options.Username.Trim())));
        PasswordVerificationResult result;
        try
        {
            result = Hasher.VerifyHashedPassword(new object(), options.PasswordHash, password);
        }
        catch (FormatException)
        {
            return false; // a malformed hash in the configuration
        }
        return userOk && result != PasswordVerificationResult.Failed;
    }

    public static Task SignInAsync(HttpContext ctx, string username) =>
        ctx.SignInAsync(Scheme, new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, username), new Claim(ClaimTypes.Role, Role)], Scheme)));

    public static string Name(ClaimsPrincipal user) => user.Identity?.Name ?? "admin";
}

/// <summary>Locks login from an address for 15 minutes after 5 failures (on top of the request rate limit).</summary>
public sealed class AdminLoginGuard
{
    public const int MaxFailures = 5;
    public static readonly TimeSpan LockTime = TimeSpan.FromMinutes(15);
    private readonly ConcurrentDictionary<string, (int Failures, DateTime LastFailure)> _state = new();

    public bool IsLocked(string key, DateTime now) =>
        _state.TryGetValue(key, out var s) && s.Failures >= MaxFailures && now - s.LastFailure < LockTime;

    public void Failed(string key, DateTime now) =>
        _state.AddOrUpdate(key, (1, now), (_, s) => (now - s.LastFailure > LockTime ? 1 : s.Failures + 1, now));

    public void Succeeded(string key) => _state.TryRemove(key, out _);
}

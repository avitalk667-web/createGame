using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Mail;

/// <summary>
/// Signed unsubscribe links: "{consentId}.{HMAC(consentId, stamp)}". The key never leaves the server (it comes from
/// PORTALX_UNSUBSCRIBE_SECRET, or is generated once and kept in the database), so a link cannot be guessed, and
/// changing the id in a link does not work. A new consent gets a new stamp, which retires the old links.
/// The token travels in the link's #fragment, so it never reaches server logs; the page posts it to the server.
/// </summary>
public sealed class UnsubscribeLinks(PortalDbContext db, IConfiguration config)
{
    private const string SecretName = "unsubscribe-key";
    private static byte[]? _cached;
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private async Task<byte[]> KeyAsync()
    {
        var fromEnv = config["PORTALX_UNSUBSCRIBE_SECRET"];
        if (!string.IsNullOrWhiteSpace(fromEnv) && fromEnv.Length >= 32) return Encoding.UTF8.GetBytes(fromEnv);
        if (_cached != null) return _cached;
        await Gate.WaitAsync();
        try
        {
            var row = await db.AppSecrets.AsNoTracking().FirstOrDefaultAsync(s => s.Name == SecretName);
            if (row == null)
            {
                row = new AppSecret { Name = SecretName, Value = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)), CreatedAt = DateTime.UtcNow };
                db.AppSecrets.Add(row);
                try { await db.SaveChangesAsync(); }
                catch (DbUpdateException)
                {
                    // another server instance created it at the same moment: use that one
                    db.ChangeTracker.Clear();
                    row = await db.AppSecrets.AsNoTracking().FirstAsync(s => s.Name == SecretName);
                }
            }
            return _cached = Convert.FromBase64String(row.Value);
        }
        finally
        {
            Gate.Release();
        }
    }

    public static string NewStamp() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public async Task<string> TokenAsync(MarketingConsent c)
    {
        var mac = HMACSHA256.HashData(await KeyAsync(), Encoding.UTF8.GetBytes($"{c.Id:N}:{c.TokenStamp}"));
        return $"{c.Id:N}.{Base64Url(mac)}";
    }

    public async Task<string> UrlAsync(MarketingConsent c, string siteUrl) => $"{siteUrl.TrimEnd('/')}/unsubscribe#t={await TokenAsync(c)}";

    /// <summary>The consent a token belongs to, or null when the token is malformed, forged or retired.</summary>
    public async Task<MarketingConsent?> FindAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return null;
        var parts = token.Trim().Split('.');
        if (parts.Length != 2 || !Guid.TryParseExact(parts[0], "N", out var id)) return null;
        var consent = await db.MarketingConsents.FirstOrDefaultAsync(c => c.Id == id);
        if (consent == null) return null;
        var expected = Encoding.ASCII.GetBytes((await TokenAsync(consent)).Split('.')[1]);
        var given = Encoding.ASCII.GetBytes(parts[1]);
        return CryptographicOperations.FixedTimeEquals(expected, given) ? consent : null;
    }

    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

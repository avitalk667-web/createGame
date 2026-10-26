using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Mail;

/// <summary>
/// Records explicit marketing consent and its revocation, wherever it was given (the end-of-game form, the personal-link
/// form). One current record per address, plus an append-only history of every grant and revocation for audit.
/// </summary>
public sealed class ConsentRecorder(PortalDbContext db, ILogger<ConsentRecorder> logger)
{
    /// <summary>An explicit tick: active from now (a revoked address becomes active only through a new tick like this).</summary>
    public async Task<bool> GrantAsync(string email, string source, Guid? sourceRoomId, string version, string text, DateTime now)
    {
        var consent = await db.MarketingConsents.FirstOrDefaultAsync(x => x.Email == email);
        if (consent is { Status: ConsentStatus.Active }) return true;
        if (consent == null)
        {
            consent = new MarketingConsent { Id = Guid.NewGuid(), Email = email };
            db.MarketingConsents.Add(consent);
        }
        // a new, explicit tick: active again from now, with a fresh unsubscribe link (old links stop working)
        consent.Status = ConsentStatus.Active;
        consent.ConsentedAt = now;
        consent.Source = source;
        consent.SourceRoomId = sourceRoomId;
        consent.ConsentVersion = version;
        consent.ConsentText = text;
        consent.RevokedAt = null;
        consent.TokenStamp = UnsubscribeLinks.NewStamp();
        consent.UpdatedAt = now;
        db.MarketingConsentEvents.Add(new MarketingConsentEvent { Email = email, Action = "granted", Source = source, ConsentVersion = version, At = now });
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // the same address consented at the same moment elsewhere: that record stands
            db.ChangeTracker.Clear();
        }
        logger.LogInformation("Marketing consent recorded (source {Source})", source);
        return true;
    }

    /// <summary>The owner unsubscribed: the record stays (revoked, never mailed) and the history keeps when.</summary>
    public async Task RevokeAsync(MarketingConsent consent, DateTime now)
    {
        if (consent.Status == ConsentStatus.Revoked) return;
        consent.Status = ConsentStatus.Revoked;
        consent.RevokedAt = now;
        consent.UpdatedAt = now;
        db.MarketingConsentEvents.Add(new MarketingConsentEvent { Email = consent.Email, Action = "revoked", Source = "unsubscribe-link", At = now });
        await db.SaveChangesAsync();
        logger.LogInformation("Marketing consent {Consent} revoked by its owner", consent.Id);
    }
}

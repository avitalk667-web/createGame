using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;
using PortalX.Server.Payments;

namespace PortalX.Server.Challenge;

public sealed record ChallengeTokenRequest(string? Token);
public sealed record ChallengeIssueRequest(string? Token, string? Email, bool MarketingConsent);

/// <summary>A personal coupon as its owner sees it (never someone else's).</summary>
public sealed record ChallengeCouponView(
    string Code, decimal DiscountPercent, DateTime IssuedAt, DateTime ExpiresAt, string ExpiresAtText, string Status, string Email,
    string? EmailStatus, bool CanResend, IReadOnlyList<string> Games);

/// <summary>
/// Where a player stands in the challenge. State: inactive, not-participating, not-finished, not-completed, not-eligible,
/// eligible, issued (their own coupon), already (this browser already has one), paused, quota-full.
/// </summary>
public sealed record ChallengeStatus(string State, string Message, int? Score, int MinimumScore, decimal DiscountPercent, ChallengeCouponView? Coupon = null);

public sealed record CampaignInput(
    string? Name, string? Description, int? MinimumScore, decimal? DiscountPercentage, int? ValidityDays, int? MaxCoupons,
    string? SourceProductId, List<string>? ProductIds, bool? ShowEntryPopup, bool? ShowProgress);

public sealed record ChallengeCouponFilter(string? Search, string? Status, DateTime? From, DateTime? To)
{
    public static ChallengeCouponFilter Parse(HttpRequest r)
    {
        string? S(string k) => string.IsNullOrWhiteSpace(r.Query[k]) ? null : r.Query[k].ToString().Trim();
        // dates are Israel days ("yyyy-MM-dd"): from the start of the first to the end of the last
        static DateTime? D(string? s, bool end) => DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? ChallengeService.IsraelDayStartUtc(end ? d.AddDays(1) : d) : null;
        return new ChallengeCouponFilter(S("search")?.ToLowerInvariant(), S("status"), D(S("from"), false), D(S("to"), true));
    }
}

/// <summary>
/// "Challenge 240" (spec): eligibility from the score the server stored for the game, one personal coupon per player,
/// address and browser, issued atomically under the campaign's row lock (so parallel requests and several tabs can never
/// pass the quota or get two coupons), the coupon email with a safe resend, and the admin's settings, list and figures.
/// The coupon itself is an ordinary one-use coupon, so checkout, reservation and redemption are the existing ones.
/// </summary>
public sealed class ChallengeService(
    PortalDbContext db, RoomService rooms, IEmailSender sender, SiteOptions site, ConsentRecorder consents, UnsubscribeLinks links,
    ILogger<ChallengeService> logger)
{
    public const string ConsentSource = "challenge-240";
    public const string ConsentVersion = "2026-11-challenge-v1";
    public const string ConsentText = "אני מסכים/ה לקבל מ-PORTAL X מיילים שיווקיים ועדכונים על משחקים חדשים, הטבות ומבצעים. ההסכמה אינה תנאי לקבלת הקופון, וניתן לבטל אותה בכל עת.";
    public const int MaxEmailAttempts = 8;
    public static readonly TimeSpan ResendWait = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan StaleSending = TimeSpan.FromMinutes(2);

    // ------------------------------------------------------------------ messages
    public const string InactiveMessage = "האתגר אינו פעיל כרגע.";
    public const string NotParticipatingMessage = "המשחק הזה אינו משתתף באתגר.";
    public const string NotFinishedMessage = "הזכאות תיבדק בסיום המשחק.";
    public const string NotCompletedMessage = "הזכאות לקופון ניתנת רק על משחק שהושלם בהצלחה.";
    public const string PausedMessage = "הנפקת הקופונים הופסקה זמנית. נסו שוב מאוחר יותר.";
    public const string QuotaFullMessage = "מכסת הקופונים של האתגר נוצלה במלואה. תודה שהשתתפתם!";
    public const string AlreadyMessage = "כבר קיבלתם קופון במסגרת האתגר. הנה הפרטים שלו.";
    public const string EmailUsedMessage = "כתובת המייל הזו כבר קיבלה קופון במסגרת האתגר. כל משתתף יכול לקבל קופון אחד בלבד.";

    private static string NotEligibleMessage(int score, int min) =>
        $"צברתם {score} נקודות. כדי לקבל את הקופון צריך לפחות {min} נקודות — נסו שוב במשחק הבא!";

    // ------------------------------------------------------------------ the public campaign

    /// <summary>The active campaign of a free game, as the site shows it (never its counts).</summary>
    public async Task<object> PublicAsync()
    {
        var c = await db.CouponCampaigns.AsNoTracking().Where(x => x.IsActive).OrderByDescending(x => x.UpdatedAt).FirstOrDefaultAsync();
        if (c == null) return new { active = false };
        return new
        {
            active = true, name = c.Name, minimumScore = c.MinimumScore, scoreAbove = c.MinimumScore - 1,
            discountPercent = c.DiscountPercentage, validityDays = c.ValidityDays, sourceProductId = c.SourceProductId,
            showEntryPopup = c.ShowEntryPopup, showProgress = c.ShowProgress,
            issuing = !c.IssuingPaused && c.IssuedCouponsCount < c.MaxCoupons,
            consentText = ConsentText, consentVersion = ConsentVersion,
        };
    }

    // ------------------------------------------------------------------ the player

    private sealed record Ctx(CouponCampaign Campaign, GameRoom Room, PlayerSession Player, string? BrowserKey);

    private async Task<(Ctx? Ctx, ChallengeStatus? Done, ServiceError? Error)> ResolveAsync(string code, string? token, string? seatCookie, string? browserId)
    {
        var room = await rooms.FindByCodeAsync(code);
        if (room == null) return (null, null, new ServiceError(404, "no-room", "המשחק לא נמצא."));
        // the player is known only by their own seat token (the body or this game's seat cookie) — never by a URL
        var t = !string.IsNullOrWhiteSpace(token) ? token : seatCookie;
        var player = string.IsNullOrEmpty(t) ? null : room.Players.FirstOrDefault(p => p.TokenHash == RoomService.Hash(t));
        if (player == null) return (null, null, new ServiceError(403, "not-in-room", "רק משתתף במשחק יכול לבדוק את הזכאות שלו."));
        var campaign = room.ProductId == null ? null : await db.CouponCampaigns.AsNoTracking().Include(c => c.Products)
            .Where(c => c.SourceProductId == room.ProductId).OrderByDescending(c => c.IsActive).ThenByDescending(c => c.UpdatedAt).FirstOrDefaultAsync();
        if (campaign == null) return (null, new ChallengeStatus("inactive", InactiveMessage, null, 0, 0), null);
        return (new Ctx(campaign, room, player, ChallengeRules.BrowserKey(browserId)), null, null);
    }

    public static int PersonalScore(GameRoom room, PlayerSession player) =>
        GameEngine.World(room).Score?.Personal.GetValueOrDefault(player.Id.ToString()) ?? 0;

    /// <summary>CheckPlayerEligibility + GetPlayerCoupon: the player's state, checked again on the server every time.</summary>
    public async Task<(ChallengeStatus? Status, ServiceError? Error)> StatusAsync(string code, string? token, string? seatCookie, string? browserId)
    {
        var (ctx, done, error) = await ResolveAsync(code, token, seatCookie, browserId);
        if (error != null) return (null, error);
        if (done != null) return (done, null);
        return (await StatusAsync(ctx!), null);
    }

    private async Task<ChallengeStatus> StatusAsync(Ctx x)
    {
        var c = x.Campaign;
        ChallengeStatus S(string state, string message, int? score = null, ChallengeCouponView? coupon = null) =>
            new(state, message, score, c.MinimumScore, c.DiscountPercentage, coupon);

        // their own coupon is always theirs to see again (after a refresh, in another tab, after the campaign ended)
        var own = await db.Coupons.AsNoTracking().FirstOrDefaultAsync(k => k.CampaignId == c.Id && k.PlayerId == x.Player.Id);
        if (own != null) return S("issued", "הקופון שלכם מוכן!", own.FinalScore, await ViewAsync(own));
        if (!c.IsActive) return S("inactive", InactiveMessage);
        if (x.Room.AccessSource != "free-sample" || x.Room.ProductId != c.SourceProductId) return S("not-participating", NotParticipatingMessage);
        var score = PersonalScore(x.Room, x.Player);
        if (x.Room.Phase != RoomPhase.Completed) return S("not-finished", NotFinishedMessage, score);
        // "completed" = the game ended in success (the gate opened), as the server recorded it for this round
        var success = await db.Results.AsNoTracking().AnyAsync(r => r.RoomId == x.Room.Id && r.Round == x.Room.Round && r.CompletionType == "success");
        if (!success) return S("not-completed", NotCompletedMessage, score);

        var row = await RecordEligibilityAsync(x, score);
        if (!row.IsEligible) return S("not-eligible", NotEligibleMessage(score, c.MinimumScore), score);
        if (x.BrowserKey != null)
        {
            var browserCoupon = await db.Coupons.AsNoTracking().FirstOrDefaultAsync(k => k.CampaignId == c.Id && k.BrowserKey == x.BrowserKey);
            if (browserCoupon != null) return S("already", AlreadyMessage, score, await ViewAsync(browserCoupon));
        }
        if (c.IssuingPaused) return S("paused", PausedMessage, score);
        if (c.MaxCoupons <= 0 || c.IssuedCouponsCount >= c.MaxCoupons) return S("quota-full", QuotaFullMessage, score);
        return S("eligible", $"הצלחתם לצבור יותר מ-{c.MinimumScore - 1} נקודות!", score);
    }

    /// <summary>One row per player and campaign; a later finished round updates it, and reaching the minimum once is kept.</summary>
    private async Task<PlayerCouponEligibility> RecordEligibilityAsync(Ctx x, int score)
    {
        var now = DateTime.UtcNow;
        var qualifies = ChallengeRules.Qualifies(score, x.Campaign.MinimumScore);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var row = await db.PlayerCouponEligibility.FirstOrDefaultAsync(e => e.CampaignId == x.Campaign.Id && e.PlayerId == x.Player.Id);
            if (row == null)
            {
                row = new PlayerCouponEligibility
                {
                    Id = Guid.NewGuid(), CampaignId = x.Campaign.Id, PlayerId = x.Player.Id, RoomId = x.Room.Id, Round = x.Room.Round,
                    BrowserKey = x.BrowserKey, FinalScore = score, IsEligible = qualifies, Reason = qualifies ? null : "score",
                    CreatedAt = now, UpdatedAt = now,
                };
                db.PlayerCouponEligibility.Add(row);
            }
            else if (row.Round != x.Room.Round || row.FinalScore != score)
            {
                row.Round = x.Room.Round;
                row.FinalScore = score;
                row.IsEligible = row.IsEligible || qualifies;
                row.Reason = row.IsEligible ? null : "score";
                row.UpdatedAt = now;
            }
            try
            {
                await db.SaveChangesAsync();
                return row;
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // the same player's other tab recorded it at the same moment: read that row
                db.ChangeTracker.Clear();
            }
        }
        throw new InvalidOperationException("eligibility row could not be saved");
    }

    /// <summary>IssueCoupon: checks everything again, then issues one coupon atomically and mails it.</summary>
    public async Task<(ChallengeStatus? Status, ServiceError? Error)> IssueAsync(string code, ChallengeIssueRequest req, string? seatCookie, string? browserId, string siteUrl)
    {
        var (ctx, done, error) = await ResolveAsync(code, req.Token, seatCookie, browserId);
        if (error != null) return (null, error);
        if (done != null) return (null, new ServiceError(409, done.State, done.Message));
        var status = await StatusAsync(ctx!);
        // a repeated click, a refresh or a second tab: the same coupon again, never a new one
        if (status.State is "issued" or "already") return (status, null);
        if (status.State != "eligible") return (null, new ServiceError(409, status.State, status.Message));

        var email = ResultsEmailService.NormalizeEmail(req.Email);
        if (email == null) return (null, new ServiceError(400, "bad-email", ResultsEmailService.BadEmailMessage));
        var c = ctx!.Campaign;
        if (await db.Coupons.AnyAsync(k => k.CampaignId == c.Id && k.Email == email))
        {
            // the same player's other tab was faster: that coupon is theirs; anyone else's address is refused
            var mine = await StatusAsync(ctx);
            return mine.State == "issued" ? (mine, null) : (null, new ServiceError(409, "email-used", EmailUsedMessage));
        }

        var now = DateTime.UtcNow;
        Coupon? created = null;
        ServiceError? refused = null;
        for (var attempt = 0; attempt < 4 && created == null && refused == null; attempt++)
        {
            try
            {
                await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    db.ChangeTracker.Clear();
                    created = null;
                    refused = null;
                    await using var tx = await db.Database.BeginTransactionAsync();
                    // the campaign row is locked: every other issue waits here, so the quota and the one-per-player rule hold
                    await db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"CouponCampaigns\" WHERE \"Id\" = {c.Id} FOR UPDATE");
                    var fresh = await db.CouponCampaigns.AsNoTracking().Include(k => k.Products).FirstAsync(k => k.Id == c.Id);
                    refused = !fresh.IsActive ? new ServiceError(409, "inactive", InactiveMessage)
                        : fresh.IssuingPaused ? new ServiceError(409, "paused", PausedMessage)
                        : fresh.MaxCoupons <= 0 || fresh.IssuedCouponsCount >= fresh.MaxCoupons ? new ServiceError(409, "quota-full", QuotaFullMessage)
                        : fresh.Products.Count == 0 ? new ServiceError(409, "no-games", "האתגר עדיין לא הוגדר במלואו. נסו שוב מאוחר יותר.")
                        : null;
                    if (refused == null && await db.Coupons.AnyAsync(k => k.CampaignId == c.Id && k.PlayerId == ctx.Player.Id)) refused = new ServiceError(409, "issued", "");
                    if (refused == null && await db.Coupons.AnyAsync(k => k.CampaignId == c.Id && k.Email == email)) refused = new ServiceError(409, "email-used", EmailUsedMessage);
                    if (refused != null)
                    {
                        await tx.RollbackAsync();
                        return;
                    }
                    var coupon = new Coupon
                    {
                        Id = Guid.NewGuid(), Code = ChallengeRules.NewCode(), Name = $"{fresh.Name} · קופון אישי", Kind = CouponKind.Percent,
                        Value = fresh.DiscountPercentage, StartsAt = now, EndsAt = ChallengeRules.ExpiresAt(now, fresh.ValidityDays),
                        MaxRedemptions = 1, Active = true, CreatedAt = now, UpdatedAt = now,
                        CampaignId = fresh.Id, Email = email, PlayerId = ctx.Player.Id, RoomId = ctx.Room.Id, BrowserKey = ctx.BrowserKey,
                        FinalScore = PersonalScore(ctx.Room, ctx.Player), EmailStatus = "pending",
                    };
                    // the coupon keeps its own copy of the games: a later change of the campaign never changes it
                    foreach (var p in fresh.Products) coupon.Products.Add(new CouponProduct { CouponId = coupon.Id, ProductId = p.ProductId });
                    db.Coupons.Add(coupon);
                    db.CouponEvents.Add(new CouponEvent
                    {
                        CouponId = coupon.Id, Action = "issued", Actor = "system", At = now,
                        DetailsJson = JsonSerializer.Serialize(new { score = coupon.FinalScore, discount = coupon.Value, validityDays = fresh.ValidityDays, marketingConsent = req.MarketingConsent }),
                    });
                    var row = await db.PlayerCouponEligibility.FirstAsync(e => e.CampaignId == c.Id && e.PlayerId == ctx.Player.Id);
                    row.Email = email;
                    row.CouponId = coupon.Id;
                    row.MarketingConsent = req.MarketingConsent;
                    row.ConsentAt = req.MarketingConsent ? now : null;
                    row.ConsentVersion = req.MarketingConsent ? ConsentVersion : null;
                    row.ConsentSource = req.MarketingConsent ? ConsentSource : null;
                    row.UpdatedAt = now;
                    await db.SaveChangesAsync();
                    await db.CouponCampaigns.Where(k => k.Id == c.Id).ExecuteUpdateAsync(s => s
                        .SetProperty(k => k.IssuedCouponsCount, k => k.IssuedCouponsCount + 1).SetProperty(k => k.UpdatedAt, now));
                    await tx.CommitAsync();
                    created = coupon;
                });
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg)
            {
                db.ChangeTracker.Clear();
                // a code that already exists (practically never): draw another one; any other rule: someone was faster
                if (pg.ConstraintName?.Contains("Code") == true) continue;
                refused = pg.ConstraintName?.Contains("Email") == true ? new ServiceError(409, "email-used", EmailUsedMessage) : new ServiceError(409, "issued", "");
            }
        }
        if (refused is { Code: "issued" or "email-used" } || (created == null && refused == null))
        {
            // another request finished first: the player's own coupon if it was theirs, otherwise the reason
            var again = await StatusAsync(ctx);
            if (again.State == "issued" || (again.State == "already" && refused?.Code != "email-used")) return (again, null);
            return (null, refused is { Code: "email-used" } ? refused : new ServiceError(409, again.State, again.Message));
        }
        if (refused != null) return (null, refused);

        logger.LogInformation("Challenge coupon {Coupon} issued for room {Code}", created!.Id, ctx.Room.Code);
        // the marketing consent is separate and optional: recorded only when its own box was ticked
        if (req.MarketingConsent) await consents.GrantAsync(email, ConsentSource, ctx.Room.Id, ConsentVersion, ConsentText, now);
        await SendEmailAsync(created.Id, "system", siteUrl);
        var issued = await db.Coupons.AsNoTracking().FirstAsync(k => k.Id == created.Id);
        return (new ChallengeStatus("issued", "הקופון שלכם מוכן!", issued.FinalScore, c.MinimumScore, issued.Value, await ViewAsync(issued)), null);
    }

    /// <summary>ResendCouponEmail by the player: the same coupon to the same address — a new coupon is never made.</summary>
    public async Task<(ChallengeStatus? Status, ServiceError? Error)> ResendAsync(string code, string? token, string? seatCookie, string? browserId, string siteUrl)
    {
        var (ctx, done, error) = await ResolveAsync(code, token, seatCookie, browserId);
        if (error != null) return (null, error);
        if (done != null) return (null, new ServiceError(409, done.State, done.Message));
        var status = await StatusAsync(ctx!);
        if (status.State is not ("issued" or "already") || status.Coupon == null) return (null, new ServiceError(409, "no-coupon", "עדיין לא הונפק לכם קופון."));
        var coupon = await db.Coupons.AsNoTracking().FirstAsync(k => k.Code == status.Coupon.Code);
        if (ResendRefusal(coupon, DateTime.UtcNow) is { } refusal) return (null, refusal);
        db.CouponEvents.Add(new CouponEvent { CouponId = coupon.Id, Action = "resend-requested", Actor = "player", At = DateTime.UtcNow });
        await db.SaveChangesAsync();
        await SendEmailAsync(coupon.Id, "player", siteUrl);
        return (await StatusAsync(ctx!), null);
    }

    private static ServiceError? ResendRefusal(Coupon c, DateTime now)
    {
        if (c.CancelledAt != null) return new ServiceError(409, "cancelled", CouponService.CancelledMessage);
        if (c.EmailStatus == "sending" && c.EmailLastAttemptAt > now - StaleSending) return new ServiceError(409, "in-progress", "המייל כבר בדרך. נסו לרענן בעוד רגע.");
        if (c.EmailLastAttemptAt is { } last && last > now - ResendWait) return new ServiceError(429, "wait", "המייל נשלח לפני רגע. אפשר לשלוח שוב בעוד דקה — ובינתיים כדאי לבדוק גם בתיקיית הספאם.");
        if (c.EmailAttempts >= MaxEmailAttempts) return new ServiceError(429, "too-many", "המייל נשלח כבר כמה פעמים. פרטי הקופון מוצגים כאן על המסך.");
        return null;
    }

    /// <summary>Sends (or resends) the coupon's email. Returns the new email status. Never creates a coupon.</summary>
    public async Task<string> SendEmailAsync(Guid couponId, string actor, string siteUrl)
    {
        var now = DateTime.UtcNow;
        var staleBefore = now - StaleSending;
        // claim the send atomically: two clicks or two tabs never send it twice at the same moment
        var claimed = await db.Coupons.Where(k => k.Id == couponId && k.CampaignId != null && k.CancelledAt == null
                && (k.EmailStatus != "sending" || k.EmailLastAttemptAt < staleBefore))
            .ExecuteUpdateAsync(s => s.SetProperty(k => k.EmailStatus, "sending").SetProperty(k => k.EmailLastAttemptAt, now));
        if (claimed == 0) return "sending";
        var coupon = await db.Coupons.AsNoTracking().FirstAsync(k => k.Id == couponId);
        var campaign = await db.CouponCampaigns.AsNoTracking().FirstAsync(k => k.Id == coupon.CampaignId);

        string? error = null, messageId = null;
        var uncertain = false;
        var attempts = 0;
        if (!await sender.IsAvailableAsync()) error = "not-configured";
        else
        {
            var consent = await db.MarketingConsents.AsNoTracking().FirstOrDefaultAsync(m => m.Email == coupon.Email && m.Status == ConsentStatus.Active);
            var model = new ChallengeEmailModel(coupon.Code, coupon.Value, coupon.EndsAt!.Value,
                (int)Math.Round((coupon.EndsAt.Value - (coupon.StartsAt ?? coupon.CreatedAt)).TotalDays), campaign.MinimumScore - 1,
                site.SiteUrl ?? siteUrl, site.ContactEmail, consent == null ? null : await links.UrlAsync(consent, site.SiteUrl ?? siteUrl));
            var message = new EmailMessage(coupon.Email!, ChallengeEmailTemplate.Subject, ChallengeEmailTemplate.Html(model), ChallengeEmailTemplate.Text(model), model.UnsubscribeUrl);
            for (var i = 0; i < 2; i++)
            {
                attempts++;
                try
                {
                    messageId = await sender.SendAsync(message);
                    error = null;
                    break;
                }
                catch (EmailSendException ex)
                {
                    error = ex.Code;
                    uncertain = ex.Uncertain;
                    if (!ex.Transient || ex.Uncertain || ex.Code is "quota" or "google-unreachable") break;
                    await Task.Delay(400);
                }
            }
        }
        var ok = error == null && !string.IsNullOrEmpty(messageId);
        var status = ok ? "sent" : uncertain ? "uncertain" : "failed";
        var at = DateTime.UtcNow;
        await db.Coupons.Where(k => k.Id == couponId).ExecuteUpdateAsync(s => s
            .SetProperty(k => k.EmailStatus, status)
            .SetProperty(k => k.EmailAttempts, k => k.EmailAttempts + Math.Max(1, attempts))
            .SetProperty(k => k.EmailLastAttemptAt, at)
            .SetProperty(k => k.EmailSentAt, k => ok ? at : k.EmailSentAt)
            .SetProperty(k => k.EmailMessageId, k => ok ? messageId : k.EmailMessageId)
            .SetProperty(k => k.EmailLastError, ok ? null : error ?? "no-message-id"));
        db.CouponEvents.Add(new CouponEvent
        {
            CouponId = couponId, Action = "email-" + status, Actor = actor, At = at,
            DetailsJson = JsonSerializer.Serialize(new { error = ok ? null : error }),
        });
        await db.SaveChangesAsync();
        // the log names the coupon, never the address
        if (ok) logger.LogInformation("Challenge coupon email {Coupon} sent", couponId);
        else logger.LogWarning("Challenge coupon email {Coupon} not confirmed: {Error}", couponId, error);
        return status;
    }

    private async Task<ChallengeCouponView> ViewAsync(Coupon c)
    {
        var now = DateTime.UtcNow;
        var redeemed = await db.CouponRedemptions.AsNoTracking().AnyAsync(r => r.CouponId == c.Id && r.Status == RedemptionStatus.Redeemed);
        var ids = await db.CouponProducts.AsNoTracking().Where(p => p.CouponId == c.Id).Select(p => p.ProductId).ToListAsync();
        var games = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).OrderBy(p => p.SortOrder).Select(p => p.Name).ToListAsync();
        var status = ChallengeRules.Status(c, redeemed, now);
        return new ChallengeCouponView(c.Code, c.Value, c.CreatedAt, c.EndsAt!.Value, ChallengeRules.FormatIsrael(c.EndsAt.Value), status,
            ChallengeRules.MaskEmail(c.Email ?? ""), c.EmailStatus, status == "active" && ResendRefusal(c, now) == null, games);
    }

    // ------------------------------------------------------------------ administration

    public static DateTime IsraelDayStartUtc(DateTime localDate)
    {
        var local = DateTime.SpecifyKind(localDate.Date, DateTimeKind.Unspecified);
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem"); }
        catch (Exception) { return DateTime.SpecifyKind(local.AddHours(-2), DateTimeKind.Utc); }
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    /// <summary>The campaign, created switched off with the spec's defaults the first time the admin opens it.</summary>
    public async Task<CouponCampaign> GetOrCreateAsync()
    {
        var c = await db.CouponCampaigns.Include(x => x.Products).OrderBy(x => x.CreatedAt).FirstOrDefaultAsync();
        if (c != null) return c;
        var free = await db.Products.AsNoTracking().Where(p => p.IsFree).OrderBy(p => p.Id == "gate-of-secrets" ? 0 : 1).ThenBy(p => p.SortOrder).FirstOrDefaultAsync()
            ?? throw new InvalidOperationException("no free game in the catalog");
        var now = DateTime.UtcNow;
        c = new CouponCampaign
        {
            Id = Guid.NewGuid(), Name = "אתגר 240", Description = "שחקן שצובר יותר מ-240 נקודות במשחק החינמי מקבל קופון אישי של 10% הנחה.",
            IsActive = false, MinimumScore = 241, DiscountPercentage = 10, ValidityDays = 8, MaxCoupons = 0, SourceProductId = free.Id,
            ShowEntryPopup = true, ShowProgress = true, CreatedAt = now, UpdatedAt = now,
        };
        db.CouponCampaigns.Add(c);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return await db.CouponCampaigns.Include(x => x.Products).OrderBy(x => x.CreatedAt).FirstAsync();
        }
        return c;
    }

    private static object Settings(CouponCampaign c) => new
    {
        c.Id, c.Name, c.Description, c.IsActive, c.IssuingPaused, c.MinimumScore, c.DiscountPercentage, c.ValidityDays, c.MaxCoupons,
        c.IssuedCouponsCount, c.SourceProductId, productIds = c.Products.Select(p => p.ProductId).OrderBy(x => x).ToList(),
        c.ShowEntryPopup, c.ShowProgress, c.StartedAt, c.CreatedAt, c.UpdatedAt,
    };

    public async Task<object> AdminViewAsync()
    {
        var c = await GetOrCreateAsync();
        var products = await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Name, p.IsFree, p.PriceIls, status = p.Status.ToString().ToLowerInvariant() }).ToListAsync();
        return new { campaign = Settings(c), products, statistics = await StatisticsAsync(c), consentText = ConsentText, consentVersion = ConsentVersion };
    }

    /// <summary>UpdateCouponCampaign. Applies to coupons issued from now on only. Returns an error message or null.</summary>
    public async Task<(string? Error, object? Before, object? After)> UpdateAsync(CampaignInput u)
    {
        var c = await GetOrCreateAsync();
        var before = Settings(c);
        if (u.Name != null)
        {
            var n = u.Name.Trim();
            if (n.Length is < 2 or > 80) return ("שם המבצע צריך להיות באורך 2–80 תווים.", null, null);
            c.Name = n;
        }
        if (u.Description != null)
        {
            if (u.Description.Length > 500) return ("התיאור ארוך מדי (עד 500 תווים).", null, null);
            c.Description = u.Description.Trim();
        }
        if (u.MinimumScore != null)
        {
            if (u.MinimumScore is < 1 or > 100000) return ("ציון הסף צריך להיות מספר שלם בין 1 ל-100,000.", null, null);
            c.MinimumScore = u.MinimumScore.Value;
        }
        if (u.DiscountPercentage != null)
        {
            var d = u.DiscountPercentage.Value;
            if (decimal.Round(d, 2) != d || d is <= 0 or >= 100) return ("אחוז ההנחה צריך להיות בין 1 ל-99 (עד שתי ספרות אחרי הנקודה).", null, null);
            c.DiscountPercentage = d;
        }
        if (u.ValidityDays != null)
        {
            if (u.ValidityDays is < 1 or > 365) return ("תוקף הקופון צריך להיות בין יום אחד ל-365 ימים.", null, null);
            c.ValidityDays = u.ValidityDays.Value;
        }
        if (u.MaxCoupons != null)
        {
            if (u.MaxCoupons is < 0 or > 1_000_000) return ("המכסה אינה תקינה.", null, null);
            if (u.MaxCoupons < c.IssuedCouponsCount) return ($"כבר הונפקו {c.IssuedCouponsCount} קופונים — המכסה לא יכולה להיות נמוכה מזה.", null, null);
            c.MaxCoupons = u.MaxCoupons.Value;
        }
        if (u.SourceProductId != null)
        {
            var src = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == u.SourceProductId);
            if (src is not { IsFree: true }) return ("משחק המקור צריך להיות משחק חינמי.", null, null);
            c.SourceProductId = src.Id;
        }
        if (u.ProductIds != null)
        {
            var ids = u.ProductIds.Distinct().ToList();
            var found = await db.Products.AsNoTracking().Where(p => ids.Contains(p.Id)).ToListAsync();
            if (found.Count != ids.Count) return ("אחד המשחקים שנבחרו לא נמצא.", null, null);
            if (found.Any(p => p.IsFree)) return ("אפשר לבחור רק משחקים בתשלום.", null, null);
            c.Products.RemoveAll(p => !ids.Contains(p.ProductId));
            foreach (var id in ids.Where(id => c.Products.All(p => p.ProductId != id)))
                c.Products.Add(new CouponCampaignProduct { CampaignId = c.Id, ProductId = id });
        }
        if (u.ShowEntryPopup != null) c.ShowEntryPopup = u.ShowEntryPopup.Value;
        if (u.ShowProgress != null) c.ShowProgress = u.ShowProgress.Value;
        if (c.IsActive && ActivationProblem(c) is { } problem) return (problem, null, null);
        c.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return (null, before, Settings(c));
    }

    private static string? ActivationProblem(CouponCampaign c) =>
        c.Products.Count == 0 ? "בחרו לפחות משחק אחד בתשלום שעליו חל הקופון."
        : c.MaxCoupons <= 0 ? "הגדירו מכסת קופונים (מספר גדול מ-0) לפני ההפעלה."
        : null;

    /// <summary>Switches the campaign on or off. Off: no popup, no progress, no new coupons; issued coupons stay valid.</summary>
    public async Task<string?> SetActiveAsync(bool active)
    {
        var c = await GetOrCreateAsync();
        if (active && ActivationProblem(c) is { } problem) return problem;
        c.IsActive = active;
        if (active) c.StartedAt ??= DateTime.UtcNow;
        c.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return null;
    }

    public async Task SetIssuingPausedAsync(bool paused)
    {
        var c = await GetOrCreateAsync();
        c.IssuingPaused = paused;
        c.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    public sealed record AdminCouponRow(
        Guid Id, string Code, string? Email, int? Score, DateTime IssuedAt, DateTime? ExpiresAt, string Status, string? EmailStatus,
        long? OrderNumber, string? PurchasedGame, DateTime? RedeemedAt, decimal? Discount, decimal? Paid, DateTime? CancelledAt, bool MarketingConsent);

    public async Task<List<AdminCouponRow>> CouponsAsync(ChallengeCouponFilter f)
    {
        var c = await GetOrCreateAsync();
        var now = DateTime.UtcNow;
        var q = db.Coupons.AsNoTracking().Where(k => k.CampaignId == c.Id);
        if (f.Search != null) q = q.Where(k => k.Email!.Contains(f.Search) || k.Code.ToLower().Contains(f.Search));
        if (f.From is { } from) q = q.Where(k => k.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(k => k.CreatedAt < to);
        var coupons = await q.OrderByDescending(k => k.CreatedAt).Take(5000).ToListAsync();
        var ids = coupons.Select(k => k.Id).ToList();
        var uses = await (from r in db.CouponRedemptions.AsNoTracking()
                          join o in db.Orders.AsNoTracking() on r.OrderId equals o.Id
                          where ids.Contains(r.CouponId) && r.Status == RedemptionStatus.Redeemed
                          select new { r.CouponId, o.Number, o.ProductName, At = o.PaidAt ?? r.UpdatedAt, r.Discount, r.FinalPrice }).ToListAsync();
        var consent = (await db.PlayerCouponEligibility.AsNoTracking().Where(e => e.CampaignId == c.Id && e.CouponId != null && e.MarketingConsent)
            .Select(e => e.CouponId!.Value).ToListAsync()).ToHashSet();
        var rows = coupons.Select(k =>
        {
            var use = uses.FirstOrDefault(u => u.CouponId == k.Id);
            return new AdminCouponRow(k.Id, k.Code, k.Email, k.FinalScore, k.CreatedAt, k.EndsAt, ChallengeRules.Status(k, use != null, now), k.EmailStatus,
                use?.Number, use?.ProductName, use?.At, use?.Discount, use?.FinalPrice, k.CancelledAt, consent.Contains(k.Id));
        });
        if (f.Status != null) rows = rows.Where(r => r.Status == f.Status);
        return rows.ToList();
    }

    public async Task<object?> CouponDetailAsync(Guid id)
    {
        var k = await db.Coupons.AsNoTracking().Include(x => x.Products).FirstOrDefaultAsync(x => x.Id == id && x.CampaignId != null);
        if (k == null) return null;
        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);
        var uses = await (from r in db.CouponRedemptions.AsNoTracking()
                          join o in db.Orders.AsNoTracking() on r.OrderId equals o.Id
                          where r.CouponId == id
                          orderby r.CreatedAt descending
                          select new { o.Number, o.ProductName, status = r.Status.ToString().ToLowerInvariant(), orderStatus = o.Status.ToString().ToLowerInvariant(), o.IsTest, r.OriginalPrice, r.Discount, r.FinalPrice, r.CreatedAt, r.UpdatedAt }).ToListAsync();
        var events = await db.CouponEvents.AsNoTracking().Where(e => e.CouponId == id).OrderBy(e => e.At)
            .Select(e => new { e.Action, e.Actor, e.At, e.DetailsJson }).ToListAsync();
        var elig = await db.PlayerCouponEligibility.AsNoTracking().FirstOrDefaultAsync(e => e.CouponId == id);
        var room = k.RoomId == null ? null : await db.Rooms.AsNoTracking().Where(r => r.Id == k.RoomId).Select(r => r.Code).FirstOrDefaultAsync();
        var redeemed = uses.Any(u => u.status == "redeemed");
        return new
        {
            k.Id, k.Code, k.Email, score = k.FinalScore, discountPercent = k.Value, issuedAt = k.CreatedAt, expiresAt = k.EndsAt,
            expiresAtText = k.EndsAt == null ? null : ChallengeRules.FormatIsrael(k.EndsAt.Value),
            status = ChallengeRules.Status(k, redeemed, DateTime.UtcNow), games = k.Products.Select(p => names.GetValueOrDefault(p.ProductId, p.ProductId)),
            k.EmailStatus, k.EmailSentAt, k.EmailAttempts, k.EmailLastError, k.CancelledAt, k.CancelledBy, roomCode = room,
            consent = elig == null ? null : new { elig.MarketingConsent, elig.ConsentAt, elig.ConsentVersion, elig.ConsentSource },
            uses, events = events.Select(e => new { e.Action, e.Actor, e.At, details = JsonDocument.Parse(e.DetailsJson).RootElement }),
        };
    }

    /// <summary>CancelCoupon: it stops working at once (a payment already in progress keeps its reservation). The record stays.</summary>
    public async Task<string?> CancelAsync(Guid id, string admin)
    {
        var k = await db.Coupons.FirstOrDefaultAsync(x => x.Id == id && x.CampaignId != null);
        if (k == null) return "הקופון לא נמצא.";
        if (k.CancelledAt != null) return "הקופון כבר בוטל.";
        if (await db.CouponRedemptions.AnyAsync(r => r.CouponId == id && r.Status == RedemptionStatus.Redeemed)) return "הקופון כבר מומש — אי אפשר לבטל אותו.";
        var now = DateTime.UtcNow;
        k.CancelledAt = now;
        k.CancelledBy = admin;
        k.Active = false;
        k.UpdatedAt = now;
        db.CouponEvents.Add(new CouponEvent { CouponId = id, Action = "cancelled", Actor = admin, At = now });
        await db.SaveChangesAsync();
        return null;
    }

    public async Task<(string? Error, string? Status)> AdminResendAsync(Guid id, string admin, string siteUrl)
    {
        var k = await db.Coupons.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.CampaignId != null);
        if (k == null) return ("הקופון לא נמצא.", null);
        if (k.CancelledAt != null) return ("הקופון בוטל.", null);
        db.CouponEvents.Add(new CouponEvent { CouponId = id, Action = "resend-requested", Actor = admin, At = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return (null, await SendEmailAsync(id, admin, siteUrl));
    }

    /// <summary>GetCouponCampaignStatistics: from the start of the campaign (when it was first switched on).</summary>
    public async Task<object> StatisticsAsync(CouponCampaign c)
    {
        var since = c.StartedAt ?? c.CreatedAt;
        var free = db.Rooms.AsNoTracking().Where(r => r.AccessSource == "free-sample" && r.ProductId == c.SourceProductId);
        var opened = await free.CountAsync(r => r.CreatedAt >= since);
        var started = await free.CountAsync(r => r.FirstStartedAt >= since);
        var completed = await db.Results.AsNoTracking().Where(x => x.CompletionType == "success" && x.CreatedAt >= since
            && free.Any(r => r.Id == x.RoomId)).Select(x => x.RoomId).Distinct().CountAsync();
        var participants = await db.Players.AsNoTracking().CountAsync(p => !p.IsRemoved && free.Any(r => r.Id == p.RoomId && r.FirstStartedAt >= since));
        var checks = db.PlayerCouponEligibility.AsNoTracking().Where(e => e.CampaignId == c.Id);
        var checkedCount = await checks.CountAsync();
        var eligible = await checks.CountAsync(e => e.IsEligible);
        var consents = await checks.CountAsync(e => e.MarketingConsent);
        var coupons = db.Coupons.AsNoTracking().Where(k => k.CampaignId == c.Id);
        var emails = await coupons.Select(k => k.Email).Distinct().CountAsync();
        var cancelled = await coupons.CountAsync(k => k.CancelledAt != null);
        var now = DateTime.UtcNow;
        var uses = await (from r in db.CouponRedemptions.AsNoTracking()
                          join k in coupons on r.CouponId equals k.Id
                          join o in db.Orders.AsNoTracking() on r.OrderId equals o.Id
                          where r.Status == RedemptionStatus.Redeemed
                          select new { r.CouponId, r.ProductId, o.ProductName, o.IsTest, r.Discount, r.FinalPrice }).ToListAsync();
        var real = uses.Where(u => !u.IsTest).ToList();
        var redeemed = uses.Select(u => u.CouponId).Distinct().Count();
        var redeemedIds = uses.Select(u => u.CouponId).ToHashSet();
        var expired = await coupons.CountAsync(k => k.CancelledAt == null && k.EndsAt <= now && !redeemedIds.Contains(k.Id));
        static double Pct(int part, int whole) => whole == 0 ? 0 : Math.Round(100.0 * part / whole, 1);
        return new
        {
            since,
            gamesOpened = opened, gamesStarted = started, gamesCompleted = completed,
            uniqueParticipants = participants, checkedPlayers = checkedCount, eligiblePlayers = eligible,
            eligibleRate = Pct(eligible, participants),
            emailsCollected = emails, marketingConsents = consents,
            issued = c.IssuedCouponsCount, remaining = Math.Max(0, c.MaxCoupons - c.IssuedCouponsCount), maxCoupons = c.MaxCoupons,
            redeemed, redemptionRate = Pct(redeemed, c.IssuedCouponsCount), cancelled, expired,
            active = Math.Max(0, c.IssuedCouponsCount - redeemed - cancelled - expired),
            // revenue counts real payments only; test payments are shown apart
            revenue = real.Sum(u => u.FinalPrice), discounts = real.Sum(u => u.Discount), testRedemptions = uses.Count - real.Count,
            byGame = real.GroupBy(u => new { u.ProductId, u.ProductName }).Select(g => new { productId = g.Key.ProductId, name = g.Key.ProductName, count = g.Count(), revenue = g.Sum(x => x.FinalPrice), discounts = g.Sum(x => x.Discount) })
                .OrderByDescending(g => g.count).ToList(),
        };
    }

    public async Task<byte[]> CsvAsync(ChallengeCouponFilter f)
    {
        static string Cell(object? v) => CsvText.Cell(v);
        static string St(string s) => s switch { "active" => "פעיל", "redeemed" => "מומש", "expired" => "פג תוקף", "cancelled" => "בוטל", _ => s };
        static string? Il(DateTime? d) => d == null ? null : ChallengeRules.ToIsrael(d.Value).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        var rows = await CouponsAsync(f);
        var sb = new StringBuilder("﻿");
        sb.AppendLine(string.Join(",", new[]
        {
            "קוד קופון", "מייל", "ניקוד", "תאריך הנפקה", "תאריך תפוגה", "סטטוס", "סטטוס מייל", "הסכמה לדיוור", "מספר הזמנה", "משחק שנרכש", "תאריך מימוש", "הנחה", "שולם", "תאריך ביטול",
        }.Select(Cell)));
        foreach (var r in rows)
            sb.AppendLine(string.Join(",", new object?[]
            {
                r.Code, r.Email, r.Score, Il(r.IssuedAt), Il(r.ExpiresAt), St(r.Status), r.EmailStatus, r.MarketingConsent ? "כן" : "לא", r.OrderNumber, r.PurchasedGame,
                Il(r.RedeemedAt), r.Discount, r.Paid, Il(r.CancelledAt),
            }.Select(Cell)));
        return Encoding.UTF8.GetBytes(sb.ToString());
    }
}

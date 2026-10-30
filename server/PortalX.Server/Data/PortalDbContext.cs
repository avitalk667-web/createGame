using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Data;

public class PortalDbContext(DbContextOptions<PortalDbContext> options) : DbContext(options)
{
    public DbSet<GameScenario> Scenarios => Set<GameScenario>();
    public DbSet<PuzzleDefinition> PuzzleDefinitions => Set<PuzzleDefinition>();
    public DbSet<GameRoom> Rooms => Set<GameRoom>();
    public DbSet<PlayerSession> Players => Set<PlayerSession>();
    public DbSet<PuzzleState> PuzzleStates => Set<PuzzleState>();
    public DbSet<GameEvent> Events => Set<GameEvent>();
    public DbSet<GameResult> Results => Set<GameResult>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<PaymentEvent> PaymentEvents => Set<PaymentEvent>();
    public DbSet<Entitlement> Entitlements => Set<Entitlement>();
    public DbSet<AdminAuditLog> AdminAuditLog => Set<AdminAuditLog>();
    public DbSet<PlayerScoreEvent> ScoreEvents => Set<PlayerScoreEvent>();
    public DbSet<FaqEntry> Faq => Set<FaqEntry>();
    public DbSet<GameQuestion> GameQuestions => Set<GameQuestion>();
    public DbSet<GameQuestionRevision> GameQuestionRevisions => Set<GameQuestionRevision>();
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<CouponProduct> CouponProducts => Set<CouponProduct>();
    public DbSet<CouponRedemption> CouponRedemptions => Set<CouponRedemption>();
    public DbSet<ResultEmailRequest> ResultEmailRequests => Set<ResultEmailRequest>();
    public DbSet<MarketingConsent> MarketingConsents => Set<MarketingConsent>();
    public DbSet<MarketingConsentEvent> MarketingConsentEvents => Set<MarketingConsentEvent>();
    public DbSet<ReferralLink> ReferralLinks => Set<ReferralLink>();
    public DbSet<ReferralVisit> ReferralVisits => Set<ReferralVisit>();
    public DbSet<CommunityLinkRequest> CommunityLinkRequests => Set<CommunityLinkRequest>();
    public DbSet<AppSecret> AppSecrets => Set<AppSecret>();
    public DbSet<MailAccount> MailAccounts => Set<MailAccount>();
    public DbSet<OAuthState> OAuthStates => Set<OAuthState>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<GameScenario>().HasKey(x => x.Id);
        b.Entity<PuzzleDefinition>().HasKey(x => x.Id);
        b.Entity<PuzzleDefinition>().HasIndex(x => x.ScenarioId);

        b.Entity<GameRoom>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.WorldJson).HasColumnType("jsonb");
            e.HasMany(x => x.Players).WithOne().HasForeignKey(p => p.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Puzzles).WithOne().HasForeignKey(p => p.RoomId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.EntitlementId).IsUnique().HasFilter("\"EntitlementId\" IS NOT NULL");
            e.Property(x => x.AccessSource).HasDefaultValue("legacy");
            e.Property(x => x.MaxPlayers).HasDefaultValue(4);
        });

        b.Entity<PlayerSession>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.TokenHash).IsUnique();
            // one record per seat in a game: a returning participant can never be stored twice
            e.HasIndex(x => new { x.RoomId, x.Seat }).IsUnique();
            e.Property(x => x.AppearanceJson).HasColumnType("jsonb");
        });

        b.Entity<PuzzleState>().HasKey(x => new { x.RoomId, x.PuzzleId });

        b.Entity<GameEvent>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.RoomId, x.ClientActionId }).IsUnique().HasFilter("\"ClientActionId\" IS NOT NULL");
            e.Property(x => x.PayloadJson).HasColumnType("jsonb");
            e.Property(x => x.ResultJson).HasColumnType("jsonb");
        });

        b.Entity<GameResult>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.RoomId);
            e.Property(x => x.AchievementsJson).HasColumnType("jsonb");
        });

        ConfigurePayments(b);

        b.Entity<Product>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.PriceIls).HasPrecision(10, 2);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.GalleryJson).HasColumnType("jsonb");
            e.Property(x => x.FeaturesJson).HasColumnType("jsonb");
            e.Property(x => x.IncludedJson).HasColumnType("jsonb");
            e.ToTable(t => t.HasCheckConstraint("CK_Products_Price", "\"PriceIls\" IS NULL OR \"PriceIls\" > 0"));
        });
    }

    private static void ConfigurePayments(ModelBuilder b)
    {
        b.Entity<Order>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Number).UseIdentityByDefaultColumn().HasIdentityOptions(startValue: 1001);
            e.HasIndex(x => x.Number).IsUnique();
            e.Property(x => x.PriceSnapshot).HasPrecision(10, 2);
            e.Property(x => x.RefundedAmount).HasPrecision(10, 2);
            e.Property(x => x.OriginalPrice).HasPrecision(10, 2);
            e.Property(x => x.DiscountAmount).HasPrecision(10, 2);
            e.Property(x => x.CouponCode).HasMaxLength(32);
            e.HasIndex(x => x.CouponId);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.Email).HasMaxLength(200);
            e.HasIndex(x => new { x.Provider, x.ProviderSessionId }).IsUnique().HasFilter("\"ProviderSessionId\" IS NOT NULL");
            e.HasIndex(x => x.CreatedAt);
            e.Property(x => x.Version).IsRowVersion();
            e.ToTable(t => t.HasCheckConstraint("CK_Orders_Price", "\"PriceSnapshot\" > 0"));
            e.HasIndex(x => x.ReferralLinkId);
            e.Property(x => x.ReferralExclusion).HasMaxLength(32);
            e.HasOne<ReferralLink>().WithMany().HasForeignKey(x => x.ReferralLinkId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ReferralLink>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Token).HasMaxLength(32);
            e.HasIndex(x => x.Token).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            // one personal link per (normalized) address
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.FirstName).HasMaxLength(40);
            e.Property(x => x.LastName).HasMaxLength(40);
            e.Property(x => x.Source).HasMaxLength(32);
            e.Property(x => x.ConsentVersion).HasMaxLength(32);
            e.Property(x => x.ConsentText).HasMaxLength(500);
            e.Property(x => x.LastEmailStatus).HasMaxLength(24);
            e.Property(x => x.LastEmailError).HasMaxLength(64);
            e.Property(x => x.LastEmailMessageId).HasMaxLength(128);
            e.Property(x => x.CommissionRate).HasPrecision(6, 4);
            e.Property(x => x.FixedCommissionAmount).HasPrecision(10, 2);
            e.HasIndex(x => x.CreatedAt);
        });

        b.Entity<ReferralVisit>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.LastClickAt);
            e.HasOne<ReferralLink>().WithMany().HasForeignKey(x => x.ReferralLinkId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<MarketingConsentEvent>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Email).HasMaxLength(254);
            e.HasIndex(x => x.Email);
            e.Property(x => x.Action).HasMaxLength(16);
            e.Property(x => x.Source).HasMaxLength(64);
            e.Property(x => x.ConsentVersion).HasMaxLength(32);
        });

        b.Entity<PaymentEvent>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.Provider, x.ProviderEventId }).IsUnique();
            e.HasIndex(x => x.OrderId);
            e.Property(x => x.Amount).HasPrecision(10, 2);
        });

        b.Entity<Entitlement>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            // one entitlement per paid order, however many times the provider confirms it
            e.HasIndex(x => x.OrderId).IsUnique().HasFilter("\"OrderId\" IS NOT NULL");
            e.Property(x => x.Version).IsRowVersion();
        });

        b.Entity<PlayerScoreEvent>(e =>
        {
            e.ToTable("PlayerScoreEvents");
            e.HasKey(x => x.Id);
            // the same award can never be stored twice (spec Part G §19)
            e.HasIndex(x => new { x.RoomId, x.Round, x.Key }).IsUnique();
        });

        b.Entity<FaqEntry>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Question).HasMaxLength(300);
            e.Property(x => x.Answer).HasMaxLength(3000);
            e.HasIndex(x => x.SortOrder);
        });

        b.Entity<GameQuestion>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.ScenarioId).HasMaxLength(64);
            e.Property(x => x.PuzzleId).HasMaxLength(64);
            e.Property(x => x.Zone).HasMaxLength(64);
            e.Property(x => x.Question).HasMaxLength(500);
            e.Property(x => x.Answer).HasMaxLength(100);
            e.Property(x => x.AcceptJson).HasColumnType("jsonb");
            e.Property(x => x.Category).HasMaxLength(60);
            e.Property(x => x.Difficulty).HasMaxLength(20);
            e.HasIndex(x => new { x.ScenarioId, x.PuzzleId, x.SortOrder });
        });

        b.Entity<GameQuestionRevision>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.BeforeJson).HasColumnType("jsonb");
            e.Property(x => x.AfterJson).HasColumnType("jsonb");
            e.HasIndex(x => new { x.QuestionId, x.At });
        });

        b.Entity<Coupon>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Code).HasMaxLength(32);
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.Value).HasPrecision(10, 2);
            e.HasMany(x => x.Products).WithOne().HasForeignKey(p => p.CouponId).OnDelete(DeleteBehavior.Cascade);
            e.ToTable(t => t.HasCheckConstraint("CK_Coupons_Value", "\"Value\" > 0 AND (\"Kind\" <> 0 OR \"Value\" < 100)"));
        });

        b.Entity<CouponProduct>(e =>
        {
            e.HasKey(x => new { x.CouponId, x.ProductId });
            e.Property(x => x.ProductId).HasMaxLength(64);
        });

        b.Entity<ResultEmailRequest>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.IdempotencyKey).HasMaxLength(120);
            // one results email per player and round, however often the request or the game's end is repeated
            e.HasIndex(x => x.IdempotencyKey).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.HasIndex(x => x.Email);
            e.HasIndex(x => x.RequestedAt);
            e.Property(x => x.ScenarioId).HasMaxLength(64);
            e.Property(x => x.ProductId).HasMaxLength(64);
            e.Property(x => x.LastError).HasMaxLength(64);
            e.Property(x => x.ProviderMessageId).HasMaxLength(128);
        });

        b.Entity<MarketingConsent>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Email).HasMaxLength(254);
            // one consent record per (normalized) address
            e.HasIndex(x => x.Email).IsUnique();
            e.HasIndex(x => x.Status);
            e.Property(x => x.Source).HasMaxLength(64);
            e.Property(x => x.ConsentVersion).HasMaxLength(32);
            e.Property(x => x.ConsentText).HasMaxLength(500);
            e.Property(x => x.TokenStamp).HasMaxLength(64);
        });

        b.Entity<CommunityLinkRequest>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => new { x.RoomId, x.Round, x.PlayerId }).IsUnique();
            e.Property(x => x.Source).HasMaxLength(64);
            e.Property(x => x.Email).HasMaxLength(254);
            e.HasIndex(x => x.RequestedAt);
        });

        b.Entity<MailAccount>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(32);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.EncryptedRefreshToken).HasMaxLength(2048);
            e.Property(x => x.KeyFingerprint).HasMaxLength(32);
            e.Property(x => x.Scopes).HasMaxLength(500);
            e.Property(x => x.ConnectedBy).HasMaxLength(64);
            e.Property(x => x.LastError).HasMaxLength(64);
        });

        b.Entity<OAuthState>(e =>
        {
            e.HasKey(x => x.StateHash);
            e.Property(x => x.StateHash).HasMaxLength(64);
            e.Property(x => x.CodeVerifier).HasMaxLength(128);
            e.Property(x => x.BindingHash).HasMaxLength(64);
            e.Property(x => x.AdminName).HasMaxLength(64);
            e.HasIndex(x => x.ExpiresAt);
        });

        b.Entity<AppSecret>(e =>
        {
            e.HasKey(x => x.Name);
            e.Property(x => x.Name).HasMaxLength(64);
            e.Property(x => x.Value).HasMaxLength(200);
        });

        b.Entity<CouponRedemption>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            // one use per order; the history stays even when the coupon is switched off
            e.HasIndex(x => x.OrderId).IsUnique();
            e.HasIndex(x => new { x.CouponId, x.Status });
            e.Property(x => x.OriginalPrice).HasPrecision(10, 2);
            e.Property(x => x.Discount).HasPrecision(10, 2);
            e.Property(x => x.FinalPrice).HasPrecision(10, 2);
            e.Property(x => x.ProductId).HasMaxLength(64);
            e.HasOne<Coupon>().WithMany().HasForeignKey(x => x.CouponId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<AdminAuditLog>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.CreatedAt);
            e.Property(x => x.DetailsJson).HasColumnType("jsonb");
        });
    }

    /// <summary>Applies migrations and mirrors the content files into the scenario tables.</summary>
    public static async Task InitializeAsync(PortalDbContext db, ScenarioCatalog catalog, IEnumerable<ProductSeed> products)
    {
        await MigrationBaseline.ApplyAsync(db);
        await ProductSeed.SeedAsync(db, products);
        foreach (var s in catalog.All)
        {
            var row = await db.Scenarios.FindAsync(s.Id) ?? db.Scenarios.Add(new GameScenario { Id = s.Id }).Entity;
            row.Name = s.Name;
            row.Description = s.Description;
            row.Duration = s.DurationMinutes;
            row.Difficulty = s.Difficulty;
            row.PuzzleIds = JsonSerializer.Serialize(s.Puzzles.Select(p => p.Id));
            row.UpdatedAt = DateTime.UtcNow;

            foreach (var p in s.Puzzles)
            {
                var def = await db.PuzzleDefinitions.FindAsync(p.Id) ?? db.PuzzleDefinitions.Add(new PuzzleDefinition { Id = p.Id }).Entity;
                def.ScenarioId = s.Id;
                def.Order = p.Order;
                def.Type = p.Type;
                def.Zone = p.Zone;
                def.Title = p.Title;
                def.Instructions = p.Instructions;
                def.PublicDataJson = p.PublicData.ToJsonString();
                def.SolutionJson = p.Solution.ToJsonString();
                def.HintsJson = JsonSerializer.Serialize(p.Hints);
                def.SuccessMessage = p.Success;
                def.FailureMessage = p.Failure;
            }
        }
        await db.SaveChangesAsync();
    }
}

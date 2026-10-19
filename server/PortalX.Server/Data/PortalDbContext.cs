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
        });

        b.Entity<PlayerSession>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.TokenHash).IsUnique();
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
    }

    /// <summary>Creates the schema if needed and mirrors the content files into the scenario tables.</summary>
    public static async Task InitializeAsync(PortalDbContext db, ScenarioCatalog catalog)
    {
        await db.Database.EnsureCreatedAsync();
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

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;

namespace PortalX.Server.Data;

/// <summary>
/// Databases created before migrations existed (EnsureCreated) already hold the InitialCreate schema
/// but have no migration history. Such a database is marked as being at InitialCreate — without touching
/// any data — and the later migrations are then applied normally.
/// </summary>
public static class MigrationBaseline
{
    public const string InitialMigrationId = "20261022143700_InitialCreate";

    public static async Task ApplyAsync(PortalDbContext db)
    {
        var creator = db.GetService<IRelationalDatabaseCreator>();
        if (await creator.ExistsAsync() && await creator.HasTablesAsync()
            && !(await db.Database.GetAppliedMigrationsAsync()).Any()
            && await TableExistsAsync(db, "Rooms"))
        {
            var history = db.GetService<IHistoryRepository>();
            await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript());
            await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(InitialMigrationId, ProductInfo.GetVersion())));
        }
        await db.Database.MigrateAsync();
    }

    private static async Task<bool> TableExistsAsync(PortalDbContext db, string table) =>
        await db.Database.SqlQuery<bool>($"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = {table}) AS \"Value\"")
            .SingleAsync();
}

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Tests;

/// <summary>Shared catalog: two separate products with server-side prices, and the migration baseline.</summary>
[Collection(DatabaseCollection.Name)]
public class ProductCatalogTests
{
    private readonly HubIntegrationTests.Factory _factory;
    public ProductCatalogTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private static string Password() => Environment.GetEnvironmentVariable("PORTALX_PG_PASSWORD")
        ?? File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PortalX", "pg.pass")).Trim();

    private static PortalDbContext Db(string database) => new(new DbContextOptionsBuilder<PortalDbContext>()
        .UseNpgsql($"Host=localhost;Port=5433;Database={database};Username=portalx;Password={Password()}").Options);

    [Fact]
    public async Task Catalog_lists_both_games_with_independent_prices()
    {
        var client = _factory.CreateClient();
        var list = await client.GetFromJsonAsync<JsonElement>("/api/products");
        var byId = list.EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!);

        Assert.True(byId.ContainsKey("last-portal"));
        Assert.True(byId.ContainsKey("hanukkah-oil"));

        var hanukkah = byId["hanukkah-oil"];
        Assert.Equal(90m, hanukkah.GetProperty("price").GetDecimal());
        Assert.Equal("ILS", hanukkah.GetProperty("currency").GetString());
        Assert.Equal(4, hanukkah.GetProperty("maxPlayers").GetInt32());
        Assert.Equal(8, hanukkah.GetProperty("gallery").GetArrayLength());
        Assert.True(hanukkah.GetProperty("playable").GetBoolean());

        // no price existed for the original game, so none is invented
        var portal = byId["last-portal"];
        Assert.False(portal.TryGetProperty("price", out var price) && price.ValueKind != JsonValueKind.Null);
        Assert.False(portal.GetProperty("priceSet").GetBoolean());
        Assert.True(portal.GetProperty("playable").GetBoolean());
    }

    [Fact]
    public async Task Unknown_or_hidden_product_is_not_found()
    {
        var client = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/products/nope")).StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        db.Products.Add(new Product { Id = "hidden-test", Name = "x", Status = ProductStatus.Hidden, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        try
        {
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/products/hidden-test")).StatusCode);
            var list = await client.GetFromJsonAsync<JsonElement>("/api/products");
            Assert.DoesNotContain(list.EnumerateArray(), p => p.GetProperty("id").GetString() == "hidden-test");
        }
        finally
        {
            await db.Products.Where(p => p.Id == "hidden-test").ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Reseeding_never_overwrites_an_existing_price()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var seeds = ProductSeed.LoadDefault();
        await ProductSeed.SeedAsync(db, seeds);
        var row = await db.Products.SingleAsync(p => p.Id == "hanukkah-oil");
        var original = row.PriceIls;
        row.PriceIls = 120;
        await db.SaveChangesAsync();
        try
        {
            await ProductSeed.SeedAsync(db, seeds);
            db.ChangeTracker.Clear();
            Assert.Equal(120m, (await db.Products.SingleAsync(p => p.Id == "hanukkah-oil")).PriceIls);
            Assert.Null((await db.Products.SingleAsync(p => p.Id == "last-portal")).PriceIls);
        }
        finally
        {
            await db.Products.Where(p => p.Id == "hanukkah-oil").ExecuteUpdateAsync(s => s.SetProperty(p => p.PriceIls, original));
        }
    }

    [Fact]
    public async Task Price_must_be_positive_in_the_database()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        db.Products.Add(new Product { Id = "zero-price-test", Name = "x", PriceIls = 0, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Legacy_database_without_history_is_baselined_and_keeps_its_data()
    {
        const string name = "portalx_baseline_test";
        await using (var admin = Db("portalx_test"))
        {
            await admin.Database.ExecuteSqlRawAsync($"DROP DATABASE IF EXISTS {name} WITH (FORCE)");
            await admin.Database.ExecuteSqlRawAsync($"CREATE DATABASE {name}");
        }
        try
        {
            // simulate a database made by the old EnsureCreated: InitialCreate schema, data, no history
            await using (var legacy = Db(name))
            {
                await legacy.GetService<IMigrator>().MigrateAsync(MigrationBaseline.InitialMigrationId);
                await legacy.Database.ExecuteSqlRawAsync("DROP TABLE \"__EFMigrationsHistory\"");
                await legacy.Database.ExecuteSqlRawAsync(
                    "INSERT INTO \"Rooms\" (\"Id\",\"Code\",\"ScenarioId\",\"Phase\",\"HostClaimHash\",\"CreatedAt\",\"Round\",\"WorldJson\",\"UpdatedAt\") " +
                    "VALUES (gen_random_uuid(),'LEGACY','last-portal',0,'',now(),1,'{{}}',now())");
            }
            await using (var db = Db(name))
            {
                await MigrationBaseline.ApplyAsync(db);
                Assert.Empty(await db.Database.GetPendingMigrationsAsync());
                Assert.Equal(1, await db.Rooms.CountAsync(r => r.Code == "LEGACY"));
                Assert.Equal(0, await db.Products.CountAsync());
            }
        }
        finally
        {
            await using var admin = Db("portalx_test");
            await admin.Database.ExecuteSqlRawAsync($"DROP DATABASE IF EXISTS {name} WITH (FORCE)");
        }
    }
}

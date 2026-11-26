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
    public async Task Every_game_carries_its_play_time_from_the_server_and_a_game_without_one_shows_none()
    {
        var expected = new Dictionary<string, (int Minutes, bool AtLeast)>
        {
            ["hanukkah-oil"] = (60, true), ["stone-maze"] = (45, true), ["last-portal"] = (60, false), ["couples-cipher"] = (60, true),
        };
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            foreach (var (id, (minutes, atLeast)) in expected)
            {
                var p = await db.Products.AsNoTracking().SingleAsync(x => x.Id == id);
                Assert.Equal(minutes, p.DurationMinutes);
                Assert.Equal(atLeast, p.DurationIsMinimum);
            }
        }

        var list = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/products");
        var seen = 0;
        foreach (var p in list.EnumerateArray())
        {
            var id = p.GetProperty("id").GetString()!;
            // the API leaves null fields out, so a game without a play time may have no "duration" at all
            var has = p.TryGetProperty("duration", out var duration) && duration.ValueKind != JsonValueKind.Null;
            if (expected.TryGetValue(id, out var e))
            {
                Assert.Equal(e.Minutes, duration.GetProperty("minutes").GetInt32());
                Assert.Equal(e.AtLeast, duration.GetProperty("atLeast").GetBoolean());
                seen++;
            }
            else Assert.False(has); // no play time set: nothing to show
        }
        Assert.True(seen >= 2);
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

    [Fact]
    public async Task The_stone_maze_card_never_tells_how_many_rooms_and_admin_texts_stay()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var p = await db.Products.FirstAsync(x => x.Id == "stone-maze");
        var original = p.FeaturesJson;
        try
        {
            // a row seeded with the room count (as on the live site): the line is replaced in its place, the others stay
            p.FeaturesJson = "[\"חדש!\",\"2 חדרים · 6 חידות\",\"1–4 משתתפים\",\"ניקוד אישי וקבוצתי\"]";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal(["חדש!", "חידות חשיבה ושיתוף פעולה", "1–4 משתתפים", "ניקוד אישי וקבוצתי"], JsonSerializer.Deserialize<List<string>>(p.FeaturesJson));
            Assert.DoesNotContain("חדרים", p.FeaturesJson);
            // only that line: the price, the name and the rest of the row are untouched
            Assert.Equal(39m, p.PriceIls);
            Assert.Equal("מבוך האבן", p.Name);
            // a text the admin wrote is never touched
            p.FeaturesJson = "[\"חדר מאתגר\"]";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal(["חדר מאתגר"], JsonSerializer.Deserialize<List<string>>(p.FeaturesJson));
        }
        finally
        {
            p.FeaturesJson = original;
            await db.SaveChangesAsync();
        }
        // the default catalog file never names the rooms on the card either
        var seed = ProductSeed.LoadDefault().Single(x => x.Id == "stone-maze");
        Assert.DoesNotContain(seed.Features, f => f.Contains("חדר"));
    }

    [Fact]
    public async Task The_couples_game_gets_its_own_cover_once_and_an_admin_cover_stays()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var p = await db.Products.FirstAsync(x => x.Id == "couples-cipher");
        var (cover, gallery, status, price) = (p.CoverImage, p.GalleryJson, p.Status, p.PriceIls);
        try
        {
            // a row seeded with the stand-in cover (as on the live site): the cover and its gallery picture change, the caption stays
            p.CoverImage = "img/stone-maze/cover.jpg";
            p.GalleryJson = "[{\"src\":\"img/stone-maze/cover.jpg\",\"caption\":\"הצופן הזוגי\"}]";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal("img/couples-cipher/cover.jpg", p.CoverImage);
            var pics = JsonSerializer.Deserialize<List<GalleryImage>>(p.GalleryJson, ScenarioCatalog.JsonOptions)!;
            Assert.Equal([new GalleryImage("img/couples-cipher/cover.jpg", "הצופן הזוגי")], pics);
            // only the picture: the status and the price are untouched
            Assert.Equal(status, p.Status);
            Assert.Equal(price, p.PriceIls);
            // a cover the admin chose is never replaced, and the Stone Maze keeps its own cover
            p.CoverImage = "img/home/taste-room.jpg";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal("img/home/taste-room.jpg", p.CoverImage);
            Assert.Equal("img/stone-maze/cover.jpg", (await db.Products.AsNoTracking().FirstAsync(x => x.Id == "stone-maze")).CoverImage);
        }
        finally
        {
            (p.CoverImage, p.GalleryJson) = (cover, gallery);
            await db.SaveChangesAsync();
        }
        // the default catalog file already names the new cover, and the picture is in the site
        var seed = ProductSeed.LoadDefault().Single(x => x.Id == "couples-cipher");
        Assert.Equal("img/couples-cipher/cover.jpg", seed.CoverImage);
    }

    [Fact]
    public async Task The_last_portal_card_shows_its_scoring_instead_of_its_length_and_admin_texts_stay()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var p = await db.Products.FirstAsync(x => x.Id == "last-portal");
        var original = p.FeaturesJson;
        try
        {
            // a database seeded before the change: the old line is replaced in its place, the others stay
            p.FeaturesJson = "[\"25–35 דקות\",\"2–4 משתתפים\"]";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal(["ניקוד אישי וקבוצתי", "2–4 משתתפים"], JsonSerializer.Deserialize<List<string>>(p.FeaturesJson));
            // running again changes nothing
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal(["ניקוד אישי וקבוצתי", "2–4 משתתפים"], JsonSerializer.Deserialize<List<string>>(p.FeaturesJson));
            // a text the admin wrote is never touched
            p.FeaturesJson = "[\"משחק של חצי שעה\"]";
            await db.SaveChangesAsync();
            await ProductSeed.ApplyFeatureFixesAsync(db);
            await db.Entry(p).ReloadAsync();
            Assert.Equal(["משחק של חצי שעה"], JsonSerializer.Deserialize<List<string>>(p.FeaturesJson));
        }
        finally
        {
            p.FeaturesJson = original;
            await db.SaveChangesAsync();
        }
        // the site's catalog (seeded at startup, with the fix applied) shows the new line and not the length
        var list = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/products");
        var features = list.EnumerateArray().First(x => x.GetProperty("id").GetString() == "last-portal").GetProperty("features").ToString();
        Assert.Contains("ניקוד אישי וקבוצתי", features);
        Assert.DoesNotContain("25–35", features);
        // the other games keep their own lines
        var hanukkah = list.EnumerateArray().First(x => x.GetProperty("id").GetString() == "hanukkah-oil").GetProperty("features").ToString();
        Assert.Contains("ניקוד אישי וקבוצתי", hanukkah);
    }
}

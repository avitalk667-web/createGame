using Microsoft.EntityFrameworkCore;
using PortalX.Server.Admin;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Tests;

/// <summary>
/// A frozen copy of the admin dashboard and games table as they were before the SQL rewrite (main 1b8b088,
/// AdminService.RoomsAsync / DashboardAsync / FreeGameReportAsync / GamesAsync). It loads every row into memory,
/// exactly like the old code; the tests compare its answers with the new queries on the same database.
/// Do not "improve" this file: it is the reference.
/// </summary>
public sealed class LegacyAdminReports(PortalDbContext db, ScenarioCatalog scenarios)
{
    private IQueryable<Order> Orders(AdminFilter f)
    {
        var q = db.Orders.AsNoTracking();
        if (!f.IncludeTest) q = q.Where(o => !o.IsTest);
        if (f.From is { } from) q = q.Where(o => o.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(o => o.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(o => o.ProductId == f.ProductId);
        if (f.Status != null && Enum.TryParse<OrderStatus>(f.Status, true, out var st)) q = q.Where(o => o.Status == st);
        if (f.Search != null)
        {
            var s = f.Search.ToLower();
            q = long.TryParse(f.Search.TrimStart('#'), out var n)
                ? q.Where(o => o.Number == n || (o.Email != null && o.Email.ToLower().Contains(s)))
                : q.Where(o => o.Email != null && o.Email.ToLower().Contains(s));
        }
        return q;
    }

    private sealed record RoomRow(GameRoom Room, Entitlement? Ent, Order? Order, int Players, GameResult? Result);

    private async Task<List<RoomRow>> RoomsAsync(AdminFilter f, int? limit = 1000)
    {
        var q = db.Rooms.AsNoTracking();
        if (f.From is { } from) q = q.Where(r => r.CreatedAt >= from);
        if (f.To is { } to) q = q.Where(r => r.CreatedAt < to);
        if (f.ProductId != null) q = q.Where(r => r.ProductId == f.ProductId);
        if (f.Access != null) q = q.Where(r => r.AccessSource == f.Access);
        if (f.Search != null) q = q.Where(r => r.Code == RoomService.NormalizeCode(f.Search));
        var ordered = q.OrderByDescending(r => r.CreatedAt);
        var list = await (limit is { } n ? ordered.Take(n) : ordered).ToListAsync();
        var ids = list.Select(r => r.Id).ToList();
        var entIds = list.Where(r => r.EntitlementId != null).Select(r => r.EntitlementId!.Value).ToList();
        var ents = await db.Entitlements.AsNoTracking().Where(e => entIds.Contains(e.Id)).ToDictionaryAsync(e => e.Id);
        var orderIds = ents.Values.Where(e => e.OrderId != null).Select(e => e.OrderId!.Value).ToList();
        var orders = await db.Orders.AsNoTracking().Where(o => orderIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id);
        var players = await db.Players.AsNoTracking().Where(p => ids.Contains(p.RoomId) && !p.IsRemoved)
            .GroupBy(p => p.RoomId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count);
        var results = (await db.Results.AsNoTracking().Where(r => ids.Contains(r.RoomId)).ToListAsync())
            .GroupBy(r => r.RoomId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First());
        var rows = list.Select(r =>
        {
            var ent = r.EntitlementId is { } eid && ents.TryGetValue(eid, out var e) ? e : null;
            var order = ent?.OrderId is { } oid && orders.TryGetValue(oid, out var o) ? o : null;
            return new RoomRow(r, ent, order, players.GetValueOrDefault(r.Id), results.GetValueOrDefault(r.Id));
        });
        if (!f.IncludeTest) rows = rows.Where(x => x.Ent?.IsTest != true);
        return rows.ToList();
    }

    private static bool Started(RoomRow r) => r.Room.Phase != RoomPhase.Lobby || r.Result != null;
    private static bool Completed(RoomRow r) => r.Room.Phase == RoomPhase.Completed || r.Result is { CompletionType: "success" };
    private static string GameStatus(RoomRow r) => Completed(r) ? "completed" : Started(r) ? "in-progress" : "not-started";

    public async Task<object> DashboardAsync(AdminFilter f)
    {
        var orders = await Orders(f with { Status = null, Search = null }).ToListAsync();
        var confirmed = orders.Where(o => o.Status is OrderStatus.Paid or OrderStatus.Refunded).ToList();
        var refunded = orders.Where(o => o.Status == OrderStatus.Refunded).ToList();
        var roomRows = await RoomsAsync(f with { Status = null, Search = null, Access = null }, limit: null);
        var managed = roomRows.Where(r => r.Room.AccessSource is "purchase" or "admin-free").ToList();
        var paidRooms = managed.Where(r => r.Room.AccessSource == "purchase").ToList();
        var freeRooms = managed.Where(r => r.Room.AccessSource == "admin-free").ToList();
        var sampleRooms = roomRows.Where(r => r.Room.AccessSource == "free-sample").ToList();
        var paidWithRoom = paidRooms.Where(r => r.Order != null).Select(r => r.Order!.Id).ToHashSet();
        var demoRooms = await RoomsAsync(f with { Status = null, Search = null, Access = RoomService.LegacyDemoAccess, IncludeTest = true }, limit: null);
        var products = await db.Products.AsNoTracking().OrderBy(p => p.SortOrder).ToListAsync();

        object Money(IEnumerable<Order> conf, IEnumerable<Order> refs)
        {
            var gross = conf.Sum(o => o.PriceSnapshot);
            var refunds = refs.Sum(o => o.RefundedAmount ?? o.PriceSnapshot);
            return new { gross, refunds, afterRefunds = gross - refunds, paidCount = conf.Count(), refundCount = refs.Count() };
        }

        return new
        {
            currency = "ILS",
            includesTest = f.IncludeTest,
            revenue = Money(confirmed, refunded),
            byProduct = products.Where(p => f.ProductId == null || p.Id == f.ProductId).Select(p => new
            {
                productId = p.Id, name = p.Name, p.IsFree,
                money = p.IsFree ? Money([], []) : Money(confirmed.Where(o => o.ProductId == p.Id), refunded.Where(o => o.ProductId == p.Id)),
                games = p.IsFree ? sampleRooms.Count(r => r.Room.ProductId == p.Id) : managed.Count(r => r.Room.ProductId == p.Id),
            }),
            freeGame = await FreeGameReportAsync(sampleRooms, products.FirstOrDefault(p => p.IsFree)),
            buyersWithEmail = confirmed.Where(o => o.Email != null).Select(o => o.Email!.ToLowerInvariant()).Distinct().Count(),
            orders = new
            {
                pending = orders.Count(o => o.Status == OrderStatus.Pending),
                failed = orders.Count(o => o.Status == OrderStatus.Failed),
                cancelled = orders.Count(o => o.Status == OrderStatus.Cancelled),
            },
            games = new
            {
                opened = managed.Count,
                started = managed.Count(Started),
                completed = managed.Count(Completed),
                paidStarted = paidRooms.Count(Started),
                adminFree = freeRooms.Count,
                adminFreeStarted = freeRooms.Count(Started),
                freeSample = sampleRooms.Count,
                freeSampleStarted = sampleRooms.Count(Started),
                freeSampleCompleted = sampleRooms.Count(Completed),
                freeSamplePlayers = sampleRooms.Sum(r => r.Players),
                demo = demoRooms.Count,
                demoStarted = demoRooms.Count(Started),
                demoCompleted = demoRooms.Count(Completed),
                purchasedNotStarted = paidRooms.Count(r => !Started(r))
                    + confirmed.Count(o => o.Status == OrderStatus.Paid && !paidWithRoom.Contains(o.Id)),
            },
            participants = managed.Sum(r => r.Players),
            testPaidOrders = f.IncludeTest ? (int?)null : await db.Orders.CountAsync(o => o.IsTest && (o.Status == OrderStatus.Paid || o.Status == OrderStatus.Refunded)),
        };
    }

    private async Task<object?> FreeGameReportAsync(List<RoomRow> sampleRooms, Product? product)
    {
        if (product == null) return null;
        var rows = sampleRooms.Where(r => r.Room.ProductId == product.Id || r.Room.ScenarioId == product.ScenarioId).ToList();
        var ids = rows.Select(r => r.Room.Id).ToList();
        var startedIds = rows.Where(Started).Select(r => r.Room.Id).ToHashSet();
        var seats = await db.Players.AsNoTracking().Where(p => ids.Contains(p.RoomId)).Select(p => new { p.Id, p.RoomId }).ToListAsync();

        var today = AdminService.IsraelTodayStartUtc(DateTime.UtcNow);
        var all = db.Rooms.AsNoTracking().Where(r => r.AccessSource == "free-sample");
        var startedToday = await all.CountAsync(r => (r.IntroStartedAt ?? r.StartedAt) >= today);
        var completedToday = await all.CountAsync(r => r.Phase == RoomPhase.Completed && r.EndedAt >= today);
        var joinedToday = await db.Players.AsNoTracking().CountAsync(p => p.JoinedAt >= today
            && db.Rooms.Any(r => r.Id == p.RoomId && r.AccessSource == "free-sample"));
        var lastStarted = await all.Where(r => r.IntroStartedAt != null || r.StartedAt != null)
            .MaxAsync(r => (DateTime?)(r.IntroStartedAt ?? r.StartedAt));

        return new
        {
            productId = product.Id, name = product.Name, kind = "free",
            created = rows.Count,
            started = startedIds.Count,
            notStarted = rows.Count - startedIds.Count,
            completed = rows.Count(Completed),
            participants = seats.Select(s => s.Id).Distinct().Count(),
            participantsInStarted = seats.Where(s => startedIds.Contains(s.RoomId)).Select(s => s.Id).Distinct().Count(),
            lastStartedAt = lastStarted,
            today = new { started = startedToday, completed = completedToday, joined = joinedToday },
            revenue = 0,
        };
    }

    public async Task<object> GamesAsync(AdminFilter f)
    {
        var rows = await RoomsAsync(f);
        var names = await db.Products.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name);
        return rows.Select(r => new
        {
            r.Room.Code,
            productId = r.Room.ProductId,
            productName = r.Room.ProductId != null && names.TryGetValue(r.Room.ProductId, out var n) ? n : scenarios.Find(r.Room.ScenarioId)?.Name,
            access = r.Room.AccessSource,
            isTest = r.Ent?.IsTest ?? false,
            orderNumber = r.Order?.Number,
            owner = r.Room.AccessSource switch { "admin-free" => "מנהל", "treasure" => "מתנה מתיבת האוצר", "free-sample" => "משחק התנסות חינמי", RoomService.LegacyDemoAccess => "הדגמה ישנה (סגור)", _ => r.Order != null ? $"הזמנה {r.Order.Number}" : null },
            r.Room.CreatedAt,
            startedAt = r.Room.IntroStartedAt ?? r.Room.StartedAt,
            r.Room.EndedAt,
            players = r.Players,
            phase = r.Room.Phase.ToString().ToLowerInvariant(),
            status = GameStatus(r),
            result = r.Result == null ? null : new
            {
                r.Result.DurationSeconds, r.Result.HintsUsed, r.Result.PuzzlesSolved, r.Result.PuzzlesTotal, r.Result.CompletionType,
            },
            groupScore = GameEngine.World(r.Room).Score?.Group,
            // added with the game-code switch (2026-11-20); every other field is the reference as it was
            disabled = r.Room.DisabledAt != null,
        });
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PortalX.Server.Data;

/// <summary>Used only by `dotnet ef` to build migrations; it never connects.</summary>
public sealed class PortalDbContextFactory : IDesignTimeDbContextFactory<PortalDbContext>
{
    public PortalDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<PortalDbContext>().UseNpgsql("Host=localhost;Database=portalx_design").Options);
}

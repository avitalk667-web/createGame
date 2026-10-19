# PORTAL X — single container: Angular client built into the ASP.NET Core server's wwwroot.
# Used by Render (free web service). Secrets (DATABASE_URL) come from the host's environment, never from this file.

# 1) Angular client
FROM node:22.14.0-alpine AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
# angular.json writes the build to ../server/PortalX.Server/wwwroot
RUN mkdir -p /src/server/PortalX.Server && npx ng build --configuration production

# 2) ASP.NET Core server
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS server
WORKDIR /src/server
COPY server/PortalX.Server/PortalX.Server.csproj PortalX.Server/
RUN dotnet restore PortalX.Server/PortalX.Server.csproj
COPY server/PortalX.Server/ PortalX.Server/
COPY --from=client /src/server/PortalX.Server/wwwroot PortalX.Server/wwwroot
RUN dotnet publish PortalX.Server/PortalX.Server.csproj -c Release -o /app --no-restore

# 3) Runtime
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=server /app ./
ENV ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_GCHeapHardLimitPercent=0x46
USER $APP_UID
# Render provides PORT (default 10000); fall back to 8080 elsewhere.
CMD ["sh", "-c", "ASPNETCORE_URLS=http://0.0.0.0:${PORT:-8080} exec dotnet PortalX.Server.dll"]

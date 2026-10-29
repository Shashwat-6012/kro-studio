FROM node:24-alpine AS ui-build
WORKDIR /workspace/src/Web
COPY src/Web/package.json src/Web/package-lock.json ./
RUN npm ci
COPY src/Web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /workspace
COPY src/Hub/KroStudio.Hub.csproj src/Hub/
RUN dotnet restore src/Hub/KroStudio.Hub.csproj
COPY src/Hub/ src/Hub/
COPY --from=ui-build /workspace/src/Web/dist/ src/Hub/wwwroot/
RUN dotnet publish src/Hub/KroStudio.Hub.csproj -c Release -o /publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=api-build /publish/ ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "KroStudio.Hub.dll"]

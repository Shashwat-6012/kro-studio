FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /workspace
COPY src/KroStudio.Web/KroStudio.Web.csproj src/KroStudio.Web/
RUN dotnet restore src/KroStudio.Web/KroStudio.Web.csproj
COPY src/KroStudio.Web/ src/KroStudio.Web/
RUN dotnet publish src/KroStudio.Web/KroStudio.Web.csproj -c Release -o /publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=api-build /publish/ ./
USER $APP_UID
ENTRYPOINT ["dotnet", "KroStudio.Web.dll"]

ARG NODE_BUILD_IMAGE=node:24.22.2-alpine3.24@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0.401-noble@sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317
ARG DOTNET_RUNTIME_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-composite@sha256:6055b3b318a59d639894ce896f5c7c309b4b826930c4ac539dbded9e750b1fdf

FROM ${NODE_BUILD_IMAGE} AS ui-build
WORKDIR /workspace/src/Web
COPY src/Web/package.json src/Web/package-lock.json ./
RUN npm ci
COPY src/Web/ ./
RUN npm run build

FROM ${DOTNET_SDK_IMAGE} AS api-build
WORKDIR /workspace
COPY src/Hub/KroStudio.Hub.csproj src/Hub/
RUN dotnet restore src/Hub/KroStudio.Hub.csproj
COPY src/Hub/ src/Hub/
COPY --from=ui-build /workspace/src/Web/dist/ src/Hub/wwwroot/
RUN dotnet publish src/Hub/KroStudio.Hub.csproj -c Release -o /publish --no-restore

FROM ${DOTNET_RUNTIME_IMAGE} AS runtime
WORKDIR /app
COPY --from=api-build /publish/ ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["dotnet", "KroStudio.Hub.dll", "--healthcheck"]
ENTRYPOINT ["dotnet", "KroStudio.Hub.dll"]

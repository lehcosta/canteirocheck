# syntax=docker/dockerfile:1
# Imagem isolada do mpp-extractor: lê MPP/XML do MS Project com o MPXJ (LGPL-2.1-or-later).
# Build: docker build -t canteirocheck-mpp-extractor services/mpp-extractor

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -B -q dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=target/lib
COPY src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre AS runtime
ENV PORT=8091 \
    JAVA_TOOL_OPTIONS="-Xmx768m -Djava.awt.headless=true"
WORKDIR /app
COPY --from=build /app/target/lib ./lib
COPY --from=build /app/target/mpp-extractor.jar ./
USER 1000
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["sh", "-c", "wget -qO- http://127.0.0.1:${PORT:-8091}/health || exit 1"]
CMD ["java", "-cp", "mpp-extractor.jar:lib/*", "leitor.Servidor"]

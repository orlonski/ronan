FROM minio/minio:latest

EXPOSE 9000 9001

# CMD com o comando completo embutido — Easypanel não precisa configurar Container Command
CMD ["server", "/data", "--console-address", ":9001"]

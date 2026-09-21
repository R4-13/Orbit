# Bakes 10-init-app-role.sh into the image with the executable bit set at
# build time, inside the Linux image filesystem — a bind-mounted script
# (the simpler alternative) loses its executable bit when the repo lives on
# a Windows host filesystem (NTFS has no Unix permission bits, and Docker
# Desktop's bind-mount bridge doesn't fabricate one), which makes the
# official postgres image's entrypoint silently skip it ("ignoring
# /docker-entrypoint-initdb.d/*") instead of failing loudly. Building it in
# sidesteps the host filesystem entirely. See docs/ASSUMPTIONS.md Phase 15.
FROM postgres:16-alpine
COPY 10-init-app-role.sh /docker-entrypoint-initdb.d/10-init-app-role.sh
RUN chmod +x /docker-entrypoint-initdb.d/10-init-app-role.sh

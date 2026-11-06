FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY app-icon.svg /usr/share/nginx/html/app-icon.svg
COPY icon-192.png /usr/share/nginx/html/icon-192.png
COPY booking.html /usr/share/nginx/html/booking.html
COPY chat /usr/share/nginx/html/chat
COPY core /usr/share/nginx/html/core
COPY css /usr/share/nginx/html/css
COPY index.html /usr/share/nginx/html/index.html
COPY invite /usr/share/nginx/html/invite
COPY journal /usr/share/nginx/html/journal
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY online-booking /usr/share/nginx/html/online-booking
COPY professional.js /usr/share/nginx/html/professional.js
COPY professional /usr/share/nginx/html/professional
COPY reset-password.html /usr/share/nginx/html/reset-password.html
COPY service-worker.js /usr/share/nginx/html/service-worker.js
COPY settings /usr/share/nginx/html/settings
COPY timetable /usr/share/nginx/html/timetable
COPY ui /usr/share/nginx/html/ui
COPY verify-email.html /usr/share/nginx/html/verify-email.html

EXPOSE 3000

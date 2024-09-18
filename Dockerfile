FROM node:18
WORKDIR /usr/src/app
COPY package*.json ./
COPY firebase_configuration_goes_here.json ./
ENV PORT 2020
RUN npm install
COPY . .
EXPOSE 2020
CMD [ "node", "index.js" ]

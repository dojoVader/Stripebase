docker build -f Dockerfile . -t stripebase && docker run -d --publish 8080:2020 --name stripebase stripebase



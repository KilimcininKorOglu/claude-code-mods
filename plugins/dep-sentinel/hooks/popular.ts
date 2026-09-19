/** Widely used package names per ecosystem, and the one a new name looks like. */

import type { Ecosystem } from './parse.ts'

const NPM = `
react react-dom next vue nuxt svelte angular @angular/core @angular/cli preact solid-js lodash lodash-es underscore ramda
express koa fastify hapi @hapi/hapi nestjs @nestjs/core axios node-fetch got request superagent ky undici cross-fetch
typescript ts-node tsx esbuild vite webpack rollup parcel babel-core @babel/core @babel/preset-env swc @swc/core terser
eslint prettier jest mocha chai vitest jasmine karma cypress playwright puppeteer sinon supertest nock @testing-library/react
moment dayjs date-fns luxon chalk commander yargs inquirer ora debug dotenv uuid nanoid classnames clsx
mongoose mongodb pg mysql mysql2 sqlite3 redis ioredis sequelize typeorm prisma @prisma/client knex drizzle-orm
socket.io socket.io-client ws graphql apollo-server @apollo/client jsonwebtoken bcrypt bcryptjs passport cors helmet
body-parser cookie-parser multer morgan winston pino bunyan nodemon pm2 concurrently cross-env rimraf mkdirp glob
fs-extra chokidar minimist semver qs ms async bluebird rxjs immer zustand redux react-redux @reduxjs/toolkit mobx
react-router react-router-dom @tanstack/react-query swr formik react-hook-form yup zod joi ajv
tailwindcss postcss autoprefixer sass less styled-components @emotion/react @mui/material antd bootstrap jquery
three d3 chart.js echarts leaflet marked markdown-it highlight.js prismjs cheerio jsdom sharp jimp canvas
electron electron-builder react-native expo @expo/vector-icons aws-sdk @aws-sdk/client-s3 firebase firebase-admin
stripe openai @anthropic-ai/sdk langchain discord.js telegraf twilio nodemailer handlebars ejs pug mustache
core-js regenerator-runtime tslib @types/node @types/react @types/express husky lint-staged
`

const PYPI = `
requests urllib3 certifi idna charset-normalizer numpy pandas scipy matplotlib seaborn scikit-learn
tensorflow keras torch torchvision torchaudio transformers datasets tokenizers accelerate diffusers
flask django fastapi starlette uvicorn gunicorn werkzeug jinja2 markupsafe itsdangerous click
sqlalchemy alembic psycopg2 psycopg2-binary psycopg pymysql mysqlclient redis celery kombu pymongo
boto3 botocore s3transfer awscli google-cloud-storage google-api-python-client azure-storage-blob
pydantic pydantic-core attrs dataclasses-json marshmallow pyyaml toml tomli python-dotenv
pytest pytest-cov pytest-mock pytest-asyncio tox nox coverage mock hypothesis
black flake8 pylint mypy isort ruff autopep8 pre-commit bandit
setuptools wheel pip virtualenv pipenv poetry twine build packaging six
beautifulsoup4 lxml html5lib scrapy selenium playwright httpx aiohttp httplib2 websockets
pillow opencv-python imageio scikit-image
cryptography pyopenssl paramiko bcrypt passlib pyjwt oauthlib requests-oauthlib
python-dateutil pytz tzdata arrow pendulum
tqdm rich colorama termcolor tabulate prettytable loguru
openai anthropic langchain langchain-core tiktoken sentence-transformers huggingface-hub
jupyter notebook ipython ipykernel jupyterlab nbformat
networkx sympy statsmodels xgboost lightgbm catboost plotly bokeh dash streamlit gradio
grpcio protobuf msgpack orjson ujson simplejson
typing-extensions filelock fsspec pyarrow polars dask
docker kubernetes ansible fabric invoke
sentry-sdk prometheus-client psutil gevent eventlet greenlet
`

const GO = `
github.com/gin-gonic/gin github.com/labstack/echo/v4 github.com/gofiber/fiber/v2 github.com/gorilla/mux
github.com/go-chi/chi/v5 github.com/julienschmidt/httprouter github.com/spf13/cobra github.com/spf13/viper
github.com/spf13/pflag github.com/urfave/cli/v2 github.com/sirupsen/logrus go.uber.org/zap github.com/rs/zerolog
github.com/stretchr/testify github.com/onsi/ginkgo/v2 github.com/onsi/gomega github.com/golang/mock
go.uber.org/mock github.com/google/uuid github.com/gofrs/uuid github.com/pkg/errors
github.com/go-sql-driver/mysql github.com/lib/pq github.com/jackc/pgx/v5 github.com/mattn/go-sqlite3
gorm.io/gorm gorm.io/driver/postgres github.com/jmoiron/sqlx github.com/redis/go-redis/v9
go.mongodb.org/mongo-driver github.com/golang-jwt/jwt/v5 golang.org/x/crypto golang.org/x/net
golang.org/x/sync golang.org/x/sys golang.org/x/text golang.org/x/tools golang.org/x/oauth2
google.golang.org/grpc google.golang.org/protobuf github.com/golang/protobuf github.com/grpc-ecosystem/grpc-gateway/v2
github.com/prometheus/client_golang github.com/aws/aws-sdk-go-v2 github.com/aws/aws-sdk-go
cloud.google.com/go/storage github.com/gorilla/websocket github.com/joho/godotenv
gopkg.in/yaml.v3 gopkg.in/yaml.v2 github.com/BurntSushi/toml github.com/mitchellh/mapstructure
github.com/go-playground/validator/v10 github.com/google/go-cmp github.com/davecgh/go-spew
github.com/fsnotify/fsnotify github.com/hashicorp/go-multierror github.com/cenkalti/backoff/v4
github.com/charmbracelet/bubbletea github.com/charmbracelet/lipgloss github.com/fatih/color
github.com/nats-io/nats.go github.com/segmentio/kafka-go github.com/IBM/sarama github.com/robfig/cron/v3
k8s.io/client-go k8s.io/apimachinery sigs.k8s.io/controller-runtime github.com/docker/docker
github.com/tidwall/gjson github.com/json-iterator/go github.com/valyala/fasthttp
`

const CRATES = `
serde serde_json serde_yaml serde_derive toml tokio tokio-util futures async-trait anyhow thiserror
clap structopt log env_logger tracing tracing-subscriber rand regex lazy_static once_cell
reqwest hyper axum actix-web warp rocket tower tower-http http bytes url
chrono time uuid itertools rayon crossbeam parking_lot dashmap indexmap hashbrown smallvec
sqlx diesel rusqlite redis mongodb sea-orm postgres tokio-postgres
base64 hex sha2 md5 ring rustls openssl hmac aes bcrypt argon2 jsonwebtoken
num num-traits bitflags byteorder memchr libc nix winapi windows-sys
syn quote proc-macro2 derive_more strum strum_macros paste cfg-if
image flate2 zip tar walkdir glob tempfile dirs directories notify
criterion proptest mockall pretty_assertions insta assert_cmd predicates
tonic prost prost-types protobuf tungstenite tokio-tungstenite
colored console indicatif dialoguer crossterm ratatui termcolor atty
wasm-bindgen js-sys web-sys serde-wasm-bindgen getrandom
nom pest csv semver humantime bincode rmp-serde ciborium
`

const PACKAGIST = `
laravel/framework laravel/laravel laravel/sanctum laravel/tinker laravel/sail laravel/horizon laravel/passport
symfony/console symfony/http-foundation symfony/http-kernel symfony/routing symfony/yaml symfony/process
symfony/finder symfony/event-dispatcher symfony/dependency-injection symfony/var-dumper symfony/mailer
symfony/framework-bundle symfony/twig-bundle symfony/validator symfony/serializer symfony/cache symfony/dotenv
guzzlehttp/guzzle guzzlehttp/psr7 guzzlehttp/promises psr/log psr/container psr/http-message psr/cache
monolog/monolog doctrine/orm doctrine/dbal doctrine/annotations doctrine/inflector doctrine/collections
phpunit/phpunit mockery/mockery fakerphp/faker phpstan/phpstan vimeo/psalm squizlabs/php_codesniffer
friendsofphp/php-cs-fixer nesbot/carbon ramsey/uuid vlucas/phpdotenv twig/twig league/flysystem
league/oauth2-client league/csv intervention/image phpmailer/phpmailer swiftmailer/swiftmailer
firebase/php-jwt aws/aws-sdk-php google/apiclient stripe/stripe-php predis/predis
nikic/php-parser composer/composer spatie/laravel-permission barryvdh/laravel-debugbar
filp/whoops nunomaduro/collision livewire/livewire inertiajs/inertia-laravel
slim/slim cakephp/cakephp yiisoft/yii2 dompdf/dompdf phpoffice/phpspreadsheet
`

const list = (text: string): string[] => text.split(/\s+/).filter(w => w !== '')

export const POPULAR: Record<Ecosystem, ReadonlySet<string>> = {
  npm: new Set(list(NPM)),
  PyPI: new Set(list(PYPI)),
  Go: new Set(list(GO)),
  'crates.io': new Set(list(CRATES)),
  Packagist: new Set(list(PACKAGIST)),
}

/** Edits between two names, a swap of two neighbours counted as one (optimal string alignment). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  const at = (i: number, j: number): number => d[i]?.[j] ?? 0
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1))
      const swapped = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ;(d[i] as number[])[j] = swapped ? Math.min(best, at(i - 2, j - 2) + 1) : best
    }
  }
  return at(a.length, b.length)
}

/** How many edits make a look-alike: none under 4 characters, one under 7, two from 7. */
const allowed = (length: number): number => (length < 4 ? 0 : length < 7 ? 1 : 2)

/** The popular name `name` looks like, when it is not popular itself. */
export function lookAlike(ecosystem: Ecosystem, name: string): string | undefined {
  const popular = POPULAR[ecosystem]
  if (popular.has(name)) return undefined
  const limit = allowed(name.length)
  if (limit === 0) return undefined
  return [...popular].find(p => Math.abs(p.length - name.length) <= limit && distance(p, name) <= limit)
}

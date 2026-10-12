const path = require('path');
const webpack = require('webpack');
const { computeBuildHash } = require('../scripts/generate-hash');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const buildHash = process.env.BUILD_HASH || computeBuildHash();
  const buildTimestamp = process.env.BUILD_TIMESTAMP || new Date().toISOString();

  return {
    entry: './src/index.tsx',
    output: {
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'dist'),
      publicPath: '/'
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      fallback: {
        buffer: false,
        crypto: false,
        stream: false,
        path: false
      }
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          use: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    devServer: {
      port: 8080,
      server: 'https',
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      historyApiFallback: true,
      allowedHosts: 'all',
      hot: false,
      liveReload: false,
      client: false
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL || ''),
        'process.env.PUBLIC_PATH': JSON.stringify(process.env.PUBLIC_PATH || ''),
        'process.env.BUILD_HASH': JSON.stringify(buildHash),
        'process.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp)
      })
    ],
    devtool: isProduction ? 'source-map' : 'eval-source-map'
  };
};

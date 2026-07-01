const path = require('path');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

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
    devtool: isProduction ? 'source-map' : 'eval-source-map'
  };
};

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-6xl font-bold text-gray-300 dark:text-gray-700">404</h1>
      <p className="text-gray-500 mt-4 mb-8">页面不存在</p>
      <Link to="/dashboard" className="text-blue-600 hover:underline">返回首页</Link>
    </div>
  );
}

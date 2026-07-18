'use client';
import { useState } from 'react';
import { Alert, Button, Card, Form, Input, message } from 'antd';
import { getSupabase } from '@/lib/supabase/client';

/** 管理员登录卡(Supabase Auth 邮箱密码)。 */
export default function LoginCard({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  const submit = async (v: { email: string; password: string }) => {
    setLoading(true);
    try {
      const { error } = await getSupabase().auth.signInWithPassword(v);
      if (error) throw error;
      message.success('登录成功');
      onLogin();
    } catch (e) {
      message.error(`登录失败:${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card title="管理员登录" style={{ maxWidth: 380, margin: '48px auto' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="请使用在 Supabase Auth 中创建的管理员账户登录后审核标记。"
      />
      <Form layout="vertical" onFinish={submit}>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="admin@example.com" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          登录
        </Button>
      </Form>
    </Card>
  );
}
